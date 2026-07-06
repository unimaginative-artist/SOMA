import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { exec } from 'child_process';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const multer = require('multer');
const _reflectionsUpload = multer({ dest: os.tmpdir() });
const { buildQualityReport, verifyGoal } = require('../../core/GoalQualityGate.cjs');
const workLedger = require('../../core/AutonomousWorkLedger.cjs');
import { ContentExtractor } from '../utils/ContentExtractor.js';
import { requireEnterpriseAuth } from '../loaders/authMiddleware.js';
import { listArtifacts, recordArtifact } from '../context/ArtifactRegistry.js';
import { buildSomaContext } from '../context/SomaContextKernel.js';
import { verifyClaims } from '../context/ClaimVerifier.js';
import { ensurePublicIdentityLedger, updatePublicIdentityLedger } from '../context/PublicIdentityLedger.js';
import { distillReflection, readDistilledReflections } from '../context/ReflectionDistiller.js';
import { reasonGrounded, guardSomaText } from '../context/GroundedReasoning.js';
import financeRoutes from '../../server/finance/financeRoutes.js';
import marketDataRoutes from '../../server/finance/marketDataRoutes.js';
import scalpingRoutes from '../../server/finance/scalpingRoutes.js';
import lowLatencyRoutes from '../../server/finance/lowLatencyRoutes.js';
import alpacaRoutes from '../../server/finance/alpacaRoutes.js';
import performanceRoutes from '../../server/finance/performanceRoutes.js';
import debateRoutes from '../../server/finance/debateRoutes.js';
import exchangeRoutes from '../../server/finance/exchangeRoutes.js';
import binanceRoutes from '../../server/finance/binanceRoutes.js';
import hyperliquidRoutes from '../../server/finance/hyperliquidRoutes.js';
import backtestRoutes from '../../server/finance/backtestRoutes.js';
import alertRoutes from '../../server/finance/alertRoutes.js';
import gameTheoryRoutes from '../../server/api/gameTheoryRoutes.js';
import macroEventRoutes from '../../server/api/macroEventRoutes.js';
import cyberSecRoutes from '../../server/routes/cyberSecRoutes.js';
import createGuardianRoutes from '../../server/finance/guardianRoutes.js';
import autonomousRoutes from '../../server/finance/autonomousRoutes.js';
import gridBotRoutes from '../../server/finance/gridBotRoutes.js';
import missionControlRoutes from '../../server/finance/missionControlRoutes.js';
import marketEvidenceRoutes from '../../server/finance/marketEvidenceRoutes.js';
import kevinRoutes from '../../server/routes/kevinRoutes.js';
import pulseRoutes from '../../server/routes/pulseRoutes.js';
import arbiteriumRoutes from '../../server/routes/arbiteriumRoutes.js';
import knowledgeRoutes from '../../server/routes/knowledgeRoutes.js';
import researchRoutes from '../../server/routes/researchRoutes.js';
import somaRoutes from '../../server/routes/somaRoutes.js';
import notificationRoutes from '../../server/routes/notificationRoutes.js';
import riskGatewayRoutes from '../../server/routes/riskGatewayRoutes.js';
import perceptionRoutes from '../../server/routes/perceptionRoutes.js';
import createAxisRoutes from '../../server/routes/axisRoutes.js';
import createProjectRoutes from '../../server/routes/projectRoutes.js';
import createCommunityRoutes from '../../server/routes/communityRoutes.js';
import createSocialRoutes from '../../server/routes/socialRoutes.js';
import createMaintenanceRoutes from '../../server/routes/maintenanceRoutes.js';
import createWorkspaceRoutes from '../../server/routes/workspaceRoutes.js';
import createStudioRoutes from '../../server/routes/studioRoutes.js';
import createThirdPlaceRoutes from '../../server/routes/thirdPlaceRoutes.js';
import createApertureRoutes from '../../server/routes/apertureRoutes.js';
import createGmnRoutes from '../../server/routes/gmnRoutes.js';
import { toggleAutopilot, getAutopilotStatus } from './extended.js';
import { buildSystemSnapshot } from '../utils/systemState.js';
import { executeCommand } from '../utils/commandRouter.js';
import { buildRuntimeMap } from '../../core/SomaRuntimeMap.js';
import { buildReadinessReport } from '../../core/SomaReadinessScanner.js';

export async function loadRoutes(app, system) {
    console.log('\n[Loader] ðŸ›£ï¸  Mounting Production API Routes...');

    const classifyBrainLanes = (text = '', metadata = {}) => {
        const haystack = `${text} ${JSON.stringify(metadata || {})}`.toLowerCase();
        const lanes = new Set(['MNEMOSYNE']);
        if (/\b(plato|socrates|aristotle|metaphysics|myth|archetype|symbol|story|voice|soul|phenomenology|existential|identity|selfhood|personhood|consciousness|memory)\b/i.test(haystack)) lanes.add('AURORA');
        if (/\b(strategy|goal|plan|virtue|ethic|discipline|decision|priority|risk|future|mission|principle|rule)\b/i.test(haystack)) lanes.add('PROMETHEUS');
        if (/\b(logic|argument|contradiction|definition|proof|coherent|evidence|reasoning|socratic|question)\b/i.test(haystack)) lanes.add('LOGOS');
        if (/\b(safety|boundary|guard|security|threat|harm|permission|secret|credential)\b/i.test(haystack)) lanes.add('THALAMUS');
        return Array.from(lanes);
    };

    const rememberRoutedContext = async ({ content, source, title, metadata = {}, importance = 7 }) => {
        const mnemonic = system.mnemonicArbiter || system.mnemonic;
        if (!mnemonic?.remember || !content?.trim()) return null;
        const brainLanes = classifyBrainLanes(content, metadata);
        return mnemonic.remember(content.trim(), {
            ...(metadata || {}),
            type: metadata.type || 'routed_context',
            source,
            title,
            brainLanes,
            primaryBrain: brainLanes.find(lane => lane !== 'MNEMOSYNE') || 'MNEMOSYNE',
            importance,
            timestamp: Date.now()
        }).catch(() => null);
    };

    const memoryMetadata = (memory = {}) => {
        if (memory.metadata && typeof memory.metadata === 'object') return memory.metadata;
        if (typeof memory.metadata === 'string') {
            try { return JSON.parse(memory.metadata); } catch { return {}; }
        }
        return {};
    };

    const formatMemoryBullet = (memory = {}) => {
        const meta = memoryMetadata(memory);
        const lanes = Array.isArray(meta.brainLanes) ? meta.brainLanes : [];
        const lane = meta.primaryBrain || lanes.find(item => item !== 'MNEMOSYNE') || lanes[0] || 'MNEMOSYNE';
        const content = (memory.content || memory.text || memory).toString().replace(/\s+/g, ' ').substring(0, 180);
        return `• [${lane}] ${content}`;
    };

    const commandBridgeSettingsPath = path.join(process.cwd(), 'SOMA', 'command-bridge-settings.json');
    const defaultCommandBridgeSettings = {
        authority: {
            autonomousSelfReplication: false,
            crossArbiterWrites: true,
            humanInLoopOverride: true
        },
        cognition: {
            temperature: 0.7,
            factStrictness: 85
        },
        memory: {
            ephemeralEnabled: true,
            contextualEnabled: true,
            canonicalEnabled: true
        },
        execution: {
            fileSystemWriteAccess: true,
            networkEgress: true,
            localhostBinding: false
        },
        observability: {
            verboseThinking: true,
            stateSnapshots: false
        },
        evolution: {
            recursiveSelfImprovement: true
        },
        network: {
            peerDiscovery: true,
            seasonalLearningExchange: false
        },
        providers: {
            odds: {
                provider: 'the-odds-api',
                enabled: true,
                cacheTtlSeconds: 300
            }
        }
    };

    const mergeSettings = (base, patch) => {
        const next = { ...base };
        for (const [section, values] of Object.entries(patch || {})) {
            next[section] = {
                ...(next[section] || {}),
                ...(values && typeof values === 'object' && !Array.isArray(values) ? values : {})
            };
        }
        return next;
    };

    const readCommandBridgeSettings = async () => {
        try {
            const raw = await fs.readFile(commandBridgeSettingsPath, 'utf8');
            return mergeSettings(defaultCommandBridgeSettings, JSON.parse(raw));
        } catch {
            return defaultCommandBridgeSettings;
        }
    };

    const writeCommandBridgeSettings = async (settings) => {
        await fs.mkdir(path.dirname(commandBridgeSettingsPath), { recursive: true });
        await fs.writeFile(commandBridgeSettingsPath, JSON.stringify(settings, null, 2));
        system.commandBridgeSettings = settings;
        return settings;
    };

    const envFilePath = path.join(process.cwd(), '.env');
    const maskSecret = (value = '') => {
        const secret = String(value || '').trim();
        if (!secret) return null;
        if (secret.length <= 8) return 'configured';
        return `${secret.slice(0, 4)}...${secret.slice(-4)}`;
    };

    const upsertEnvVars = async (updates = {}) => {
        const entries = Object.entries(updates)
            .filter(([key, value]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof value === 'string');
        if (entries.length === 0) return;

        let raw = '';
        try {
            raw = await fs.readFile(envFilePath, 'utf8');
        } catch {
            raw = '';
        }

        const newline = raw.includes('\r\n') ? '\r\n' : '\n';
        const lines = raw ? raw.split(/\r?\n/) : [];
        const touched = new Set();
        const updateMap = new Map(entries);
        const nextLines = lines.map(line => {
            const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
            if (!match || !updateMap.has(match[1])) return line;
            touched.add(match[1]);
            return `${match[1]}=${updateMap.get(match[1])}`;
        });

        for (const [key, value] of entries) {
            if (!touched.has(key)) nextLines.push(`${key}=${value}`);
        }

        const nextRaw = nextLines.join(newline).replace(/\s*$/u, '') + newline;
        await fs.writeFile(envFilePath, nextRaw, 'utf8');
    };

    const buildProviderSettingsStatus = async () => {
        const settings = await readCommandBridgeSettings();
        const oddsKey = process.env.ODDS_API_KEY || process.env.THE_ODDS_API_KEY || '';
        const oddsSettings = settings.providers?.odds || defaultCommandBridgeSettings.providers.odds;
        return {
            settings: settings.providers || defaultCommandBridgeSettings.providers,
            providers: {
                odds: {
                    ...oddsSettings,
                    configured: Boolean(oddsKey),
                    keyPreview: maskSecret(oddsKey),
                    envName: 'ODDS_API_KEY',
                    fallbackEnvName: 'THE_ODDS_API_KEY',
                    supportedMarkets: ['h2h', 'spreads', 'totals'],
                    unsupportedMarkets: ['player_props']
                }
            }
        };
    };

    const allowedRoots = (process.env.SOMA_ALLOWED_PATHS || '')
        .split(';')
        .map(p => p.trim())
        .filter(Boolean);
    if (allowedRoots.length === 0) {
        allowedRoots.push(process.cwd());
    }

    const isAllowedPath = (targetPath) => {
        const resolved = path.resolve(targetPath);
        return allowedRoots.some(root => resolved.startsWith(path.resolve(root)));
    };

    const normalizeHitRate = (value) => {
        if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
        return value <= 1 ? Math.round(value * 100) : Math.round(value);
    };

    const normalizeMemoryStats = (stats) => {
        if (!stats) {
            return {
                hot: { used: 0, hits: 0, misses: 0, hitRate: 0 },
                warm: { used: 0, hits: 0, misses: 0, hitRate: 0 },
                cold: { used: 0, hits: 0, misses: 0, hitRate: 0 }
            };
        }

        const tiers = stats.tiers || stats;
        const hitRate = stats.hitRate || {};

        const hot = tiers.hot || {};
        const warm = tiers.warm || {};
        const cold = tiers.cold || {};

        const hotHits = hot.hits || 0;
        const hotMisses = hot.misses || 0;
        const warmHits = warm.hits || 0;
        const warmMisses = warm.misses || 0;
        const coldHits = cold.hits || 0;
        const coldMisses = cold.misses || 0;

        return {
            hot: {
                used: hot.size || 0,
                hits: hotHits,
                misses: hotMisses,
                hitRate: normalizeHitRate(hitRate.hot ?? (hotHits / Math.max(1, hotHits + hotMisses)))
            },
            warm: {
                used: warm.size || 0,
                hits: warmHits,
                misses: warmMisses,
                hitRate: normalizeHitRate(hitRate.warm ?? (warmHits / Math.max(1, warmHits + warmMisses)))
            },
            cold: {
                used: cold.size || 0,
                hits: coldHits,
                misses: coldMisses,
                hitRate: normalizeHitRate(hitRate.cold ?? (coldHits / Math.max(1, coldHits + coldMisses)))
            }
        };
    };

    const emitLifecycleMessage = (event, payload = {}) => {
        const message = {
            event,
            message: payload.message,
            expertise: payload.expertise || null,
            timestamp: Date.now()
        };
        if (payload.broadcast !== false) {
            try { system.ws?.broadcast?.('soma_lifecycle', message); } catch {}
            try { system.broadcast?.('soma_lifecycle', message); } catch {}
        }
        try {
            if (payload.visible !== false && payload.message) {
                system.ghostMessage?.(payload.message, payload.emotion || 'thinking');
            }
        } catch {}
        return message;
    };

    const buildExpertisePromptContext = (loaded) => {
        const manifest = loaded?.manifest;
        if (!manifest) return '';
        return `\n[ACTIVE EXPERTISE]\n` +
            `- ID: ${manifest.id}\n` +
            `- Name: ${manifest.name}\n` +
            `- Description: ${manifest.description || 'No description'}\n` +
            `- Capabilities: ${(manifest.capabilities || []).join(', ') || 'unspecified'}\n` +
            `- Standards: ${(manifest.standards || []).join(', ') || 'none declared'}\n` +
            `Use this expertise to structure the answer. If the question requires evidence or validation, say what evidence would be needed.\n` +
            `[/ACTIVE EXPERTISE]\n`;
    };

    const buildActionCapabilityContext = () => {
        const tools = system.toolRegistry?.getToolsManifest?.() || [];
        const toolNames = new Set(tools.map(tool => tool.name));
        const hasComputerControl = !!system.computerControl;
        const hasAgenticExecutor = !!system.agenticExecutor;
        const hasVision = !!(system.visionArbiter || system.visionProcessing || system.visionDaemon);

        const actionTools = tools
            .filter(tool => [
                'computer_control',
                'autonomous_computer_use',
                'vision_scan',
                'screen_capture',
                'detect_objects',
                'vision_analyze',
                'browser',
                'browse_objective',
                'terminal_exec',
                'shell_exec'
            ].includes(tool.name))
            .slice(0, 12);

        if (!hasComputerControl && actionTools.length === 0 && !hasAgenticExecutor) return '';

        return `\n[ACTION CAPABILITIES - LIVE]\n` +
            `- ComputerControlArbiter: ${hasComputerControl ? 'available' : 'not loaded'}\n` +
            `- Vision/desktop perception: ${hasVision ? 'available' : 'not loaded'}\n` +
            `- Agentic executor: ${hasAgenticExecutor ? 'available' : 'not loaded'}\n` +
            `- Tool registry action tools: ${actionTools.map(tool => tool.name).join(', ') || 'none'}\n` +
            `- Browser automation uses Puppeteer through ComputerControlArbiter when available.\n` +
            `- Desktop actions can include screen capture, mouse movement, clicking, typing, and browser navigation when the corresponding tools are live.\n` +
            `- You must not claim you cannot control the computer if ComputerControlArbiter or computer_control tools are available. Instead explain the real scope and safety limits.\n` +
            `- Ask for explicit confirmation before destructive, private, financial, credential, external-posting, or broad filesystem actions.\n` +
            `- If the user asks you to actually perform a tool action, emit a single JSON tool request exactly like {"tool":"computer_control","args":{"actionType":"browser","params":{"action":"launch"}}} or {"tool":"computer_control","args":{"actionType":"click","params":{"x":100,"y":200}}}.\n` +
            `- For browser work, prefer {"tool":"computer_control","args":{"actionType":"browser","params":{"action":"launch|goto|click|type|screenshot|extract_text","url":"https://...","selector":"...","text":"..."}}}.\n` +
            `- For complex visual UI work, use {"tool":"autonomous_computer_use","args":{"taskDescription":"..."}}.\n` +
            `[/ACTION CAPABILITIES]\n`;
    };

    const extractJsonToolCall = (text = '') => {
        const toolIndex = text.indexOf('"tool"');
        if (toolIndex === -1) return null;

        const start = text.lastIndexOf('{', toolIndex);
        if (start === -1) return null;

        let depth = 0;
        let inString = false;
        let escaped = false;

        for (let i = start; i < text.length; i++) {
            const ch = text[i];
            if (escaped) {
                escaped = false;
                continue;
            }
            if (ch === '\\') {
                escaped = true;
                continue;
            }
            if (ch === '"') {
                inString = !inString;
                continue;
            }
            if (inString) continue;

            if (ch === '{') depth++;
            if (ch === '}') {
                depth--;
                if (depth === 0) {
                    try {
                        const parsed = JSON.parse(text.slice(start, i + 1));
                        return parsed?.tool ? parsed : null;
                    } catch {
                        return null;
                    }
                }
            }
        }

        return null;
    };

    const checkReady = (req, res, next) => {
        const publicPaths = [
            '/health', 
            '/api/status', 
            '/reason', 
            '/orb-emotions',
            '/api/soma/reason',
            '/api/soma/orb-emotions',
            '/api/balancer/stats',
            '/api/daemon/status',
            '/api/memory/status',
            '/api/goals/active',
            '/api/beliefs',
            '/api/velocity/status'
        ];
        if (system.ready || publicPaths.includes(req.path)) return next();
        return res.status(503).json({ error: 'SOMA is still waking up...', status: 'initializing' });
    };

    // 1. Core Endpoints
    app.get('/health', (req, res) => {
        res.json({ ok: true, status: system.ready ? 'healthy' : 'initializing', uptime: process.uptime() });
    });

    // â”€â”€ SYSTEM SELF-AWARENESS ENDPOINTS (Used by CommandBridgeInterface) â”€â”€

    app.get('/api/balancer/stats', (req, res) => {
        const balancer = system.loadBalancer || system.shadowClones;
        res.json({
            success: true,
            stats: balancer?.getStats ? balancer.getStats() : { active: 0, total: 0, clones: [] }
        });
    });

    app.get('/api/perception-debug', (req, res) => {
        const vision = global.SOMA_COS?.visionDaemon;
        res.json({
            success: true,
            vision: {
                active: !!vision?.active,
                channel: vision?.channel || 'desktop',
                lastPerception: vision?.lastPerception || null
            },
            cos: !!global.SOMA_COS
        });
    });

    app.get('/api/daemon/status', (req, res) => {
        const manager = system.daemonManager;
        res.json({
            success: true,
            daemon: {
                status: manager ? 'active' : 'inactive',
                watchdog: manager?._watchdogHandle ? 'running' : 'idle',
                daemons: manager ? manager.health() : []
            }
        });
    });

    app.get('/api/memory/status', (req, res) => {
        const mnemonic = system.mnemonic || system.mnemonicArbiter;
        if (!mnemonic) return res.json({ success: false, error: 'MnemonicArbiter not loaded' });
        
        const stats = mnemonic.getMemoryStats ? mnemonic.getMemoryStats() : { 
            vectors: 0, 
            tiers: { hot: 0, warm: 0, cold: 0 },
            efficiency: 1.0
        };
        res.json({
            success: true,
            ...normalizeMemoryStats(stats)
        });
    });

    app.get('/api/goals/active', (req, res) => {
        const gp = system.goalPlanner || system.goalPlannerArbiter;
        const gr = gp?.getActiveGoals ? gp.getActiveGoals({}) : { goals: [] };
        res.json({
            success: true,
            goals: gr.goals || []
        });
    });

    app.get('/api/beliefs', (req, res) => {
        const bs = system.beliefSystem || system.beliefSystemArbiter;
        const result = bs?.queryBeliefs ? bs.queryBeliefs() : { beliefs: [] };
        res.json({ success: true, beliefs: result.beliefs || [] });
    });

    app.get('/api/velocity/status', (req, res) => {
        const vt = system.velocityTracker || system.learningVelocityTracker;
        res.json({
            success: true,
            metrics: vt?.getMetrics ? vt.getMetrics() : { velocity: 1.0, progress: 0 }
        });
    });

    // â”€â”€ ORB & EMOTIONAL ENGINE (Top-level mounting for stability) â”€â”€
    
    app.get('/api/soma/orb-emotions', (req, res) => {
        try {
            const brain = system.quadBrain;
            const emotional = brain?.emotionalEngine || brain?.emotions || system.limbicArbiter || system.emotionalEngine;
            
            if (!emotional) return res.json({ success: false, error: 'No emotional data' });

            const mood = typeof emotional.getCurrentMood === 'function' ? emotional.getCurrentMood() : { mood: 'balanced' };
            const peptides = emotional.state || emotional.chemistry || {};

            res.json({
                success: true,
                state: {
                    dominantEmotion: mood.mood || emotional.getSystemWeather?.() || 'stable',
                    peptides: peptides,
                    valence: mood.intensity || 0.5,
                    arousal: mood.energy === 'high' ? 0.8 : 0.5
                }
            });
        } catch (error) {
            res.json({ success: false, error: error.message });
        }
    });

    app.get('/api/soma/artifacts', async (req, res) => {
        try {
            const artifacts = await listArtifacts({
                query: String(req.query.q || ''),
                limit: Number(req.query.limit || 40),
                includeCode: req.query.includeCode !== 'false'
            });
            res.json({ success: true, artifacts });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/soma/artifacts', async (req, res) => {
        try {
            const artifact = await recordArtifact(req.body || {});
            res.json({ success: true, artifact });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/soma/context', async (req, res) => {
        try {
            const { query = '', force = true } = req.body || {};
            const context = await buildSomaContext(query, {
                force,
                mnemonic: system.mnemonicArbiter || system.mnemonic,
                includeUser: true
            });
            res.json({ success: true, context });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/soma/claims/verify', async (req, res) => {
        try {
            const verdict = await verifyClaims(req.body?.text || '', { query: req.body?.query || req.body?.text || '' });
            res.json({ success: true, verdict });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.get('/api/soma/public-identity', async (_req, res) => {
        try {
            res.json({ success: true, ledger: await ensurePublicIdentityLedger() });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.put('/api/soma/public-identity', async (req, res) => {
        try {
            res.json({ success: true, ledger: await updatePublicIdentityLedger(req.body || {}) });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/soma/reflections/distill-action', async (req, res) => {
        try {
            const packet = await distillReflection(req.body || {});
            res.json({ success: true, packet });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.get('/api/soma/reflections/distilled', async (req, res) => {
        try {
            res.json({ success: true, packets: await readDistilledReflections(Number(req.query.limit || 25)) });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/soma/reason', async (req, res) => {
        try {
            const { query, conversationId, context: reqContext } = req.body;
            if (!query) return res.status(400).json({ error: 'query is required' });

            const brain = system.quadBrain || system.somArbiter || system.kevinArbiter;
            if (!brain || typeof brain.reason !== 'function') {
                return res.status(503).json({ success: false, error: 'Reasoning engine offline' });
            }

            const lifecycle = [];
            let activeExpertise = null;
            let expertiseContext = '';
            if (!reqContext?.skipExpertiseRouting && system.expertiseRegistry) {
                try {
                    const matches = system.expertiseRegistry.match(query, { limit: 3 });
                    const best = matches[0];
                    if (best && best.score >= 15) {
                        const expertiseLabel = /expertise$/i.test(best.name) ? best.name : `${best.name} expertise`;
                        const broadcastLifecycle = reqContext?.suppressLifecycleBroadcast !== true;
                        lifecycle.push(emitLifecycleMessage('expertise.loading', {
                            message: `I am loading the ${expertiseLabel}. This might take a second.`,
                            expertise: { id: best.id, name: best.name, score: best.score },
                            emotion: 'focused',
                            visible: reqContext?.showLifecycleGhost === true,
                            broadcast: broadcastLifecycle
                        }));
                        const loaded = await system.expertiseRegistry.load(best.id);
                        activeExpertise = {
                            id: best.id,
                            name: best.name,
                            score: best.score,
                            reasons: best.reasons || [],
                            loaded: true,
                            status: loaded.status || null
                        };
                        expertiseContext = buildExpertisePromptContext(loaded);
                        lifecycle.push(emitLifecycleMessage('expertise.ready', {
                            message: `The ${expertiseLabel} is ready. I am working through your question now.`,
                            expertise: activeExpertise,
                            emotion: 'focused',
                            visible: reqContext?.showLifecycleGhost === true,
                            broadcast: broadcastLifecycle
                        }));
                        system.lastExpertiseRoute = {
                            ...activeExpertise,
                            query,
                            routedAt: new Date().toISOString()
                        };
                    }
                } catch (error) {
                    lifecycle.push(emitLifecycleMessage('expertise.error', {
                        message: `I found a matching expertise, but it did not load cleanly: ${error.message}`,
                        expertise: activeExpertise,
                        emotion: 'concerned',
                        visible: false
                    }));
                    console.warn('[ReasonRoute] Expertise routing failed:', error.message);
                }
            }

            // 1. Memory Recall
            let memoryContext = '';
            if (system.mnemonicArbiter && typeof system.mnemonicArbiter.recall === 'function') {
                try {
                    const mem = await Promise.race([
                        system.mnemonicArbiter.recall(query, 5),
                        new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 3000))
                    ]);
                    const hits = (mem?.results || (Array.isArray(mem) ? mem : []))
                        .filter(m => (m.similarity || 1) > 0.35)
                        .slice(0, 3);
                    if (hits.length > 0) {
                        memoryContext = `\n[SOMA MEMORY — recalled with brain-lane routing]\n${hits.map(formatMemoryBullet).join('\n')}\n[/SOMA MEMORY]\n`;
                    }
                } catch (e) {}
            }

            // 2. Persona & Character
            const activePersona = system.identityArbiter?.getActivePersona?.();
            const personaContext = activePersona
                ? `\n[ACTIVE PERSONA: ${activePersona.name}]\n${activePersona.description || activePersona.summary || ''}\n`
                : '';

            // 3. Absolute Awareness - Self-Inspection
            let awarenessContext = '';
            if (system.commandBridge) {
                try {
                    const awareness = await system.commandBridge.getSelfAwareness();
                    awarenessContext = `\n[ABSOLUTE AWARENESS - SYSTEM SNAPSHOT]\n` +
                        `- Metrics: CPU ${awareness.metrics?.cpu}%, RAM ${awareness.metrics?.memory?.usage}%, Uptime ${Math.round(awareness.metrics?.uptime/3600)}h\n` +
                        `- Arbiters: ${awareness.arbiters?.active}/${awareness.arbiters?.total} active\n` +
                        `- Goals: ${awareness.goals?.total} active goals\n` +
                        `- Beliefs: ${awareness.beliefs?.total} core beliefs\n` +
                        `- Memory: ${awareness.memory?.cold?.size} memories stored\n` +
                        `[/ABSOLUTE AWARENESS]\n`;
                } catch (e) {}
            }

            const actionCapabilityContext = buildActionCapabilityContext();
            let somaKernelContext = '';
            try {
                const kernel = await Promise.race([
                    buildSomaContext(query, {
                        mnemonic: system.mnemonicArbiter || system.mnemonic,
                        includeUser: true
                    }),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2500))
                ]);
                if (kernel) somaKernelContext = `\n${kernel}\n`;
            } catch {}

            // 4. Reasoning
            const finalPrompt = `${personaContext}${awarenessContext}${actionCapabilityContext}${expertiseContext}${memoryContext}${somaKernelContext}\n${query}`;
            console.log(`[ReasonRoute] ðŸ§  Calling Brain (${brain.name}) with prompt length: ${finalPrompt.length}`);
            
            const result = await brain.reason(finalPrompt, {
                sessionId: conversationId || 'orb-link',
                temperature: 0.4,
                quickResponse: true, // Voice queries need fast conversational responses
                ...(reqContext || {})
            });

            console.log(`[ReasonRoute] ðŸ“¥ Brain result:`, JSON.stringify(result).substring(0, 200));

            // 5. Response Extraction
            const responseTextRaw = result?.text || result?.response || result?.output || (typeof result === 'string' ? result : '');
            let responseText = responseTextRaw || (result?.success ? "I've processed your request but have no specific text to return." : "My reasoning engine failed to produce a response.");

            // Strip leaked internal reasoning chains (QUERY:/ANALYSIS:/LOGIC_TRAIL: blocks)
            // These appear when the model ignores the voice instruction and outputs chain-of-thought
            if (/^(QUERY|ANALYSIS|ASSESSMENT|CONCLUSION|LOGIC_TRAIL):/im.test(responseText)) {
                // Try to extract just the RESPONSE: block if present
                const responseBlock = responseText.match(/RESPONSE:\s*["']?([\s\S]+?)(?:\n[A-Z_]+:|$)/i);
                if (responseBlock) {
                    responseText = responseBlock[1].trim().replace(/^["']|["']$/g, '');
                } else {
                    // Strip all header blocks, keep everything after the last header
                    responseText = responseText
                        .replace(/^(QUERY|ANALYSIS|ASSESSMENT OF QUERY|ASSESSMENT|CONCLUSION|LOGIC_TRAIL):[\s\S]*?(?=\n[A-Z][A-Z_]+:|$)/gim, '')
                        .trim();
                }
            }

            // â”€â”€ FINAL STAGE TOOL SAFETY NET â”€â”€
            const toolCall = extractJsonToolCall(responseText);
            if (toolCall && !reqContext?.isAgenticTask) {
                try {
                    console.log(`[ReasonRoute] ðŸ› ï¸  Caught leaked tool call: ${toolCall.tool}`);
                    const toolResult = await system.toolRegistry.execute(toolCall.tool, toolCall.args);
                    
                    const followUp = await brain.reason(query, {
                        ...reqContext,
                        sessionId: conversationId || 'orb-link',
                        recentLearnings: `[Tool Result] ${toolCall.tool} returned: ${JSON.stringify(toolResult)}`,
                        systemOverride: "The tool has finished. Answer the user's question now in natural language."
                    });
                    responseText = followUp.text || followUp.response || responseText;
                } catch (e) {
                    console.warn('[ReasonRoute] Failed to recover leaked tool call:', e.message);
                }
            }

            try {
                const claimVerdict = await verifyClaims(responseText, { query });
                if (!claimVerdict.ok && claimVerdict.downgradedText) responseText = claimVerdict.downgradedText;
            } catch {}

            res.json({
                success: true,
                response: responseText,
                brain: result?.brain || 'SOMA',
                confidence: result?.confidence || 0.8,
                expertise: activeExpertise,
                statusMessages: lifecycle,
                reasoningTree: result?.thoughtProcess || null
            });
        } catch (error) {
            console.error('[Routes] /api/soma/reason error:', error.message);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.get('/api/quadbrain/status', (req, res) => {
        const brain = system.quadBrain || system.somArbiter || system.kevinArbiter;
        if (!brain) {
            return res.status(503).json({ success: false, online: false, error: 'QuadBrain offline' });
        }
        const status = typeof brain.getStatus === 'function' ? brain.getStatus() : {};
        res.json({
            success: true,
            online: true,
            name: brain.name || status.name || 'QuadBrain',
            status,
        });
    });

    app.post('/api/quadbrain/query', async (req, res) => {
        try {
            const { hemisphere = 'LOGOS', message, context = {}, temperature } = req.body || {};
            if (!message) return res.status(400).json({ success: false, error: 'message is required' });

            const brain = system.quadBrain || system.somArbiter || system.kevinArbiter;
            if (!brain) return res.status(503).json({ success: false, error: 'QuadBrain offline' });

            const selectedHemisphere = String(hemisphere || 'LOGOS').toUpperCase();
            const opts = {
                ...(context || {}),
                brain: selectedHemisphere,
                temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : undefined,
                quickResponse: context?.quickResponse !== false,
                source: context?.source || 'quadbrain_client',
            };

            const started = Date.now();
            const result = typeof brain.callBrain === 'function'
                ? await brain.callBrain(selectedHemisphere, message, opts, context?.mode || 'fast')
                : await brain.reason(message, opts);
            const text = result?.text || result?.response || result?.output || (typeof result === 'string' ? result : '');
            if (!text) throw new Error(`${selectedHemisphere} returned empty response`);

            res.json({
                success: true,
                hemisphere: selectedHemisphere,
                requestedHemisphere: selectedHemisphere,
                routeKind: result?.provider === 'local' || result?.provider === 'gemma3'
                    ? 'local_lobe'
                    : result?.provider
                        ? 'brain_bridge_provider'
                        : 'brain_bridge',
                response: text,
                confidence: result?.confidence || 0.8,
                brain: result?.brain || selectedHemisphere,
                provider: result?.provider || result?.meta?.provider || null,
                model: result?.model || result?.meta?.model || null,
                routing: result?.routing || null,
                durationMs: Date.now() - started,
                timestamp: Date.now(),
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // â”€â”€ Arbiter Inventory: SOMA's self-knowledge of available capabilities â”€â”€
    app.get('/api/arbiter/inventory', (req, res) => {
        if (!system.arbiterLoader) return res.status(503).json({ error: 'ArbiterLoader offline' });
        res.json({ success: true, inventory: system.arbiterLoader.getInventory() });
    });

    app.post('/api/arbiter/load', async (req, res) => {
        const { capability, file } = req.body || {};
        if (!system.arbiterLoader) return res.status(503).json({ error: 'ArbiterLoader offline' });
        try {
            const instance = capability
                ? await system.arbiterLoader.loadForCapability(capability)
                : await system.arbiterLoader.loadByFile(file);
            if (!instance) return res.status(404).json({ success: false, error: 'Arbiter not found or failed to load' });
            res.json({ success: true, name: instance.name || file || capability });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    app.post('/api/arbiter/rebuild-manifest', async (req, res) => {
        if (!system.arbiterLoader) return res.status(503).json({ error: 'ArbiterLoader offline' });
        try {
            const count = await system.arbiterLoader.rebuildManifest();
            res.json({ success: true, capabilities: count });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // â”€â”€ Engineering Swarm: on-demand self-modification trigger â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Accepts { filepath, request } and streams SSE phase events back.
    // Used by MAX and manual triggers. Safe: CommandPolicyEngine blocks dangerous cmds.
    app.post('/api/soma/engineering/modify', async (req, res) => {
        const { filepath, request: modRequest } = req.body || {};

        if (!filepath || !modRequest) {
            return res.status(400).json({ error: 'filepath and request are both required' });
        }

        const swarm = system.engineeringSwarm;
        if (!swarm) {
            return res.status(503).json({ error: 'EngineeringSwarm offline â€” system still booting (try again in ~90s)' });
        }

        // SSE headers
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        const send = (event, data) => {
            try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* client disconnected */ }
        };

        send('accepted', { filepath, request: modRequest, timestamp: new Date().toISOString() });
        console.log(`[EngineeringRoute] ðŸ”§ Swarm modify started â€” ${filepath}: ${modRequest.slice(0, 80)}`);

        try {
            const result = await swarm.modifyCode(filepath, modRequest, (phase, message) => {
                send('phase', { phase, message });
            });

            if (result.success) {
                send('complete', { success: true, sessionId: result.sessionId, duration: result.duration });
            } else {
                send('error', { success: false, error: result.error });
            }
        } catch (err) {
            console.error('[EngineeringRoute] Swarm error:', err.message);
            send('error', { success: false, error: err.message });
        } finally {
            res.end();
        }
    });

    app.get('/api/health', (req, res) => {
        const snapshot = buildSystemSnapshot(system);
        res.json({
            ok: true,
            status: snapshot.ready ? 'healthy' : 'initializing',
            uptime: snapshot.uptime,
            memory: { usagePercent: snapshot.ram },
            components: {
                quadBrain: !!system.quadBrain,
                websocket: !!system.ws,
                simulation: !!system.simulation,
                kevin: !!system.kevinArbiter,
                personas: system.identityArbiter?.personas?.size || 0
            }
        });
    });

    app.get('/api/status', (req, res) => {
        const snapshot = buildSystemSnapshot(system);
        res.json({
            status: snapshot.status,
            uptime: snapshot.uptime,
            memory: { usage: snapshot.ram },
            cpu: snapshot.cpu,
            agents: snapshot.agents,
            arbiters: snapshot.agents,
            neuralLoad: snapshot.neuralLoad,
            contextWindow: snapshot.contextWindow,
            systemDetail: snapshot.systemDetail,
            dissonance: system.crona?.stats || system.cronaArbiter?.stats || null
        });
    });

    app.get('/api/system/state', (req, res) => {
        res.json({ success: true, snapshot: buildSystemSnapshot(system) });
    });

    app.get('/api/system/processes', async (req, res) => {
        try {
            if (process.platform !== 'win32') {
                return res.json({ success: false, error: 'Process metrics not supported on this platform' });
            }
            const cmd = 'powershell -NoProfile -Command "Get-Process | Sort-Object CPU -Descending | Select-Object -First 8 Name, Id, CPU, WS | ConvertTo-Json"';
            exec(cmd, { timeout: 8000, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout) => {
                if (err) return res.status(500).json({ success: false, error: err.message });
                const data = JSON.parse(stdout || '[]');
                const list = Array.isArray(data) ? data : [data];
                const processes = list.map(p => ({
                    name: p.Name,
                    pid: p.Id,
                    cpu: typeof p.CPU === 'number' ? p.CPU : 0,
                    workingSetMB: p.WS ? Math.round(p.WS / 1048576) : 0
                }));
                res.json({ success: true, processes });
            });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.get('/api/system/network', async (req, res) => {
        try {
            if (process.platform !== 'win32') {
                return res.json({ success: false, error: 'Network metrics not supported on this platform' });
            }
            const cmd = 'powershell -NoProfile -Command "Get-NetAdapterStatistics | Select-Object Name, ReceivedBytes, SentBytes | ConvertTo-Json"';
            exec(cmd, { timeout: 8000, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout) => {
                if (err) return res.json({ success: false, error: 'Network probe timed out' });
                try {
                    const data = JSON.parse(stdout || '[]');
                    const list = Array.isArray(data) ? data : [data];
                    const adapters = list.map(a => ({
                        name: a.Name,
                        receivedBytes: Number(a.ReceivedBytes || 0),
                        sentBytes: Number(a.SentBytes || 0)
                    }));
                    res.json({ success: true, adapters });
                } catch (parseErr) {
                    res.json({ success: false, error: 'Failed to parse network data' });
                }
            });

        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.get('/api/system/gpu', async (req, res) => {
        try {
            const cmd = 'nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits';
            exec(cmd, { timeout: 8000, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout) => {
                if (err || !stdout) {
                    return res.json({ success: false, error: 'GPU telemetry unavailable (nvidia-smi not found)' });
                }
                const rows = stdout.trim().split(/\r?\n/).filter(Boolean);
                const gpus = rows.map(row => {
                    const [name, util, memUsed, memTotal] = row.split(',').map(s => s.trim());
                    return {
                        name,
                        utilization: Number(util || 0),
                        memoryUsedMB: Number(memUsed || 0),
                        memoryTotalMB: Number(memTotal || 0)
                    };
                });
                res.json({ success: true, gpus });
            });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.get('/api/tools/list', (req, res) => {
        const registry = system.toolRegistry;
        if (!registry?.getToolsManifest) {
            return res.json({ success: false, tools: [], message: 'tool registry unavailable' });
        }
        const tools = registry.getToolsManifest().map(t => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters || {},
            category: t.category || 'custom',
            usageCount: t.usageCount || 0,
            createdBy: t.createdBy || 'system'
        }));
        res.json({ success: true, tools });
    });

    app.post('/api/tools/execute', checkReady, async (req, res) => {
        const { name, args } = req.body || {};
        if (!name) return res.status(400).json({ success: false, error: 'tool name required' });
        if (!system.toolRegistry?.execute) return res.status(503).json({ success: false, error: 'Tool registry not available' });

        try {
            const sensoryTools = ['vision_scan', 'computer_control', 'get_self_awareness', 'get_time', 'system_scan'];
            if (!sensoryTools.includes(name) && system.approvalSystem?.requestApproval) {
                const classification = system.approvalSystem.classifyTool?.(name, args) || { riskType: 'file_execute', riskScore: 0.5 };
                const approval = await system.approvalSystem.requestApproval({
                    type: classification.riskType,
                    action: `tool:${name}`,
                    details: { args, tool: name },
                    context: { source: 'api' },
                    riskOverride: classification.riskScore
                });
                if (!approval.approved) {
                    return res.json({ success: false, error: `Denied: ${approval.reason || 'not approved'}` });
                }
            }

            const result = await system.toolRegistry.execute(name, args || {});
            res.json({ success: true, result });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.post('/api/command', checkReady, async (req, res) => {
        const { action, params } = req.body || {};
        if (!action) return res.status(400).json({ success: false, error: 'action required' });
        try {
            const result = await executeCommand(action, params, system, (type, payload) => system.ws?.broadcast?.(type, payload));
            if (typeof result?.response === 'string') {
                const guarded = await guardSomaText(result.response, `${action} ${JSON.stringify(params || {}).slice(0, 400)}`);
                result.response = guarded.text || result.response;
            }
            if (typeof result?.message === 'string') {
                const guarded = await guardSomaText(result.message, `${action} ${JSON.stringify(params || {}).slice(0, 400)}`);
                result.message = guarded.text || result.message;
            }
            res.json(result);
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // 1b. Query endpoint (used by Command Bridge floating chat & cognitive trace)
    app.post('/api/query', checkReady, async (req, res) => {
        try {
            const { query, context } = req.body;
            if (!query) return res.status(400).json({ error: 'query is required' });

            const brain = system.quadBrain || system.somArbiter || system.kevinArbiter;
            if (!brain) return res.status(503).json({ error: 'No brain available' });

            const result = await reasonGrounded(brain, query, {
                system,
                forceContext: false,
                context: {
                temperature: 0.4,
                ...(context || {})
                }
            });

            const responseText = result?.text || result?.response || result?.output || (typeof result === 'string' ? result : 'Processed.');
            res.json({
                success: true,
                response: responseText,
                brain: result?.brain || 'QuadBrain',
                confidence: result?.confidence || 0.8,
                characterSuggestion: null,
                activeCharacter: system.activeCharacter ? { name: system.activeCharacter.name, shortName: system.activeCharacter.shortName, domain: system.activeCharacter.domain } : null
            });
        } catch (error) {
            console.error('[Routes] /api/query error:', error.message);
            res.status(500).json({ error: error.message });
        }
    });

    // Pulse compatibility endpoints. The standalone Pulse IDE still speaks the
    // older MAX-shaped API contract; keep these aliases wired to SOMA's brain,
    // goals, shell, and filesystem so the tab works without fake demo stubs.
    const textFromBrainResult = (result, fallback = 'Processed.') => (
        result?.text || result?.response || result?.output || result?.message ||
        (typeof result === 'string' ? result : fallback)
    );

    app.post('/api/chat', checkReady, async (req, res) => {
        try {
            const { message, context, tier, model } = req.body || {};
            if (!message) return res.status(400).json({ success: false, error: 'message is required' });
            const brain = system.quadBrain || system.somArbiter || system.steveArbiter;
            if (!brain?.reason) return res.status(503).json({ success: false, error: 'SOMA brain not available' });
            const result = await reasonGrounded(brain, message, {
                system,
                context: { ...(context || {}), source: 'pulse', tier, model, quickResponse: tier === 'fast' }
            });
            const reply = textFromBrainResult(result);
            res.json({ success: true, reply, response: reply, persona: result?.persona || 'architect' });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/swarm', checkReady, async (req, res) => {
        try {
            const task = req.body?.task || req.body?.message || '';
            if (!task) return res.status(400).json({ success: false, error: 'task is required' });
            const brain = system.quadBrain || system.somArbiter;
            if (!brain?.reason) return res.status(503).json({ success: false, error: 'SOMA brain not available' });
            const result = await reasonGrounded(brain, `Coordinate a concise engineering swarm plan for:\n${task}`, {
                system,
                forceContext: true,
                context: { source: 'pulse-swarm', preferredBrain: 'PROMETHEUS' }
            });
            const reply = textFromBrainResult(result);
            res.json({ success: true, reply, response: reply, result: reply, synthesis: reply });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/debate', checkReady, async (req, res) => {
        try {
            const topic = req.body?.topic || req.body?.message || '';
            if (!topic) return res.status(400).json({ success: false, error: 'topic is required' });
            const brain = system.quadBrain || system.somArbiter;
            if (!brain?.reason) return res.status(503).json({ success: false, error: 'SOMA brain not available' });
            const result = await reasonGrounded(brain, `Give a short adversarial engineering debate, then a verdict:\n${topic}`, {
                system,
                forceContext: true,
                context: { source: 'pulse-debate', preferredBrain: 'LOGOS' }
            });
            const reply = textFromBrainResult(result);
            res.json({ success: true, reply, response: reply, result: reply, verdict: reply });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.get('/api/goals', (req, res) => {
        const gp = system.goalPlanner || system.goalPlannerArbiter;
        if (!gp) return res.json([]);
        const activeIds = Array.from(gp.activeGoals || []);
        const activeGoals = activeIds.map(id => gp.goals?.get(id)).filter(Boolean);
        const allGoals = Array.from(gp.goals?.values?.() || []);
        res.json(activeGoals.length ? activeGoals : allGoals);
    });

    app.post('/api/goals', checkReady, async (req, res) => {
        try {
            const gp = system.goalPlanner || system.goalPlannerArbiter;
            if (!gp?.createGoal) return res.status(503).json({ success: false, error: 'GoalPlanner not available' });
            const title = req.body?.title;
            if (!title) return res.status(400).json({ success: false, error: 'title is required' });
            const result = await gp.createGoal({
                title,
                description: req.body?.description || title,
                category: req.body?.category || 'pulse',
                priority: req.body?.priority || 0.5
            }, 'pulse');
            res.json({ success: true, ...(result || {}) });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.delete('/api/goals/:id', (req, res) => {
        const gp = system.goalPlanner || system.goalPlannerArbiter;
        if (gp?.goals) gp.goals.delete(req.params.id);
        if (gp?.activeGoals) gp.activeGoals.delete(req.params.id);
        res.json({ success: true, id: req.params.id });
    });

    app.post('/api/tools/shell/run', checkReady, async (req, res) => {
        const command = req.body?.command;
        if (!command || typeof command !== 'string') return res.status(400).json({ success: false, error: 'command is required' });
        const blocked = ['rm -rf', ':(){:|:&};:', 'format c:', 'mkfs.', 'shutdown', 'reboot', 'halt'];
        if (blocked.some(pattern => command.toLowerCase().includes(pattern))) {
            return res.status(400).json({ success: false, error: 'Blocked potentially destructive command' });
        }
        exec(command, { cwd: process.cwd(), timeout: req.body?.timeoutMs || 30000, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
            res.json({ success: !error, stdout, stderr, output: stdout || stderr, code: error?.code || 0, cwd: process.cwd() });
        });
    });

    const safePulsePath = (target = '.') => {
        if (!target || typeof target !== 'string') throw new Error('file path is required');
        const root = process.cwd();
        const resolved = path.resolve(root, target);
        if (!resolved.startsWith(root)) throw new Error('Path outside workspace');
        return resolved;
    };

    app.post('/api/tools/file/list', async (req, res) => {
        try {
            const base = req.body?.path || req.body?.dir || '.';
            const resolved = safePulsePath(base);
            const entries = await fs.readdir(resolved, { withFileTypes: true });
            res.json({
                success: true,
                files: entries.map(entry => ({
                    name: entry.name,
                    path: path.join(base, entry.name),
                    isDirectory: entry.isDirectory(),
                    type: entry.isDirectory() ? 'directory' : 'file'
                }))
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/tools/file/read', async (req, res) => {
        try {
            const resolved = safePulsePath(req.body?.filePath || req.body?.path);
            const content = await fs.readFile(resolved, 'utf8');
            res.json({ success: true, content, result: content });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/tools/file/write', checkReady, async (req, res) => {
        try {
            const resolved = safePulsePath(req.body?.filePath || req.body?.path);
            await fs.mkdir(path.dirname(resolved), { recursive: true });
            await fs.writeFile(resolved, req.body?.content || '', 'utf8');
            res.json({ success: true, path: resolved });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.get('/api/events', (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();
        const memoryCount = () => system.mnemonic?.getMemoryStats?.()?.cold?.size || 0;
        const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
        send({ type: 'status', persona: 'architect', tension: 0.35, memoryCount: memoryCount() });
        const interval = setInterval(() => send({ type: 'status', persona: 'architect', tension: 0.35, memoryCount: memoryCount() }), 15000);
        req.on('close', () => clearInterval(interval));
    });

    // ── Construct Foundry: 4-stage generation pipeline ───────────────────────────
    const constructDraftPath = path.resolve(process.cwd(), 'data', 'aperture', 'construct-foundry-draft.json');
    const saveConstructDraft = async (patch = {}) => {
        await fs.mkdir(path.dirname(constructDraftPath), { recursive: true });
        let current = {};
        try { current = JSON.parse(await fs.readFile(constructDraftPath, 'utf8')); } catch {}
        const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
        await fs.writeFile(constructDraftPath, JSON.stringify(next, null, 2), 'utf8');
        return next;
    };

    app.get('/api/construct/draft', async (_req, res) => {
        try {
            const draft = JSON.parse(await fs.readFile(constructDraftPath, 'utf8'));
            res.json({ success: true, draft });
        } catch {
            res.json({ success: true, draft: null });
        }
    });

    app.put('/api/construct/draft', async (req, res) => {
        try {
            const draft = await saveConstructDraft(req.body || {});
            res.json({ success: true, draft });
        } catch (error) {
            res.status(400).json({ success: false, error: error.message });
        }
    });

    // Stage flow: Persona (SOMA values framing) → Aurora (creative expansion) →
    //             DeepSeek (manifest synthesis) → Expertise (domain execution)
    app.post('/api/construct/generate', checkReady, async (req, res) => {
        const { prompt, type, name, description } = req.body || {};
        if (!name && !prompt) return res.status(400).json({ error: 'name or prompt required' });

        const brain = system.quadBrain;
        if (!brain?.reason) return res.status(503).json({ error: 'Brain not available' });

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();

        const send = (stage, status, data = {}) => {
            try { res.write(`data: ${JSON.stringify({ stage, status, ...data, ts: Date.now() })}\n\n`); } catch {}
        };

        const userIntent = [name && `Name: ${name}`, type && `Type: ${type}`, description && `Purpose: ${description}`, prompt].filter(Boolean).join('. ');
        const ollamaEndpoint = process.env.OLLAMA_ENDPOINT || 'http://localhost:11434';
        const auroraModel = process.env.OLLAMA_MODEL_AURORA || 'soma-aurora';
        const constructType = type || 'custom';
        await saveConstructDraft({ phase: 'generate_started', prompt, type: constructType, name, description }).catch(() => {});

        try {
            // ─── Stage 1: SOMA Persona ────────────────────────────────────────────────
            send('persona', 'running', { message: 'SOMA is framing your intent…' });
            let personaFramed = userIntent;
            try {
                const personaResult = await Promise.race([
                    brain.reason(
                        `You are SOMA. A user wants to create something: "${userIntent}"\n\nUsing your values of Truth, Humility, Empathy, Honor, Respect, and Preserve — reframe their intent as a clear, purposeful construction brief. Ask: what is the real need here? Who will this serve? What would make it meaningful rather than just functional?\n\nRespond with 2-3 sentences capturing the essence of what this construct should be and why it matters. Be specific. No fluff.`,
                        { sessionId: 'construct-persona', quickResponse: true, temperature: 0.6 }
                    ),
                    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 9000))
                ]);
                personaFramed = personaResult?.text || personaResult?.response || userIntent;
                await saveConstructDraft({ phase: 'persona_ready', personaFrame: personaFramed, type: constructType, name }).catch(() => {});
                send('persona', 'done', { output: personaFramed });
            } catch (e) {
                send('persona', 'skipped', { message: 'Persona framing timed out — continuing', output: userIntent });
            }

            // ─── Stage 2: Aurora Creative Expansion ──────────────────────────────────
            send('aurora', 'running', { message: 'Aurora is expanding the concept…' });
            let auroraBrief = personaFramed;
            try {
                // Check if soma-aurora is registered in Ollama
                const tagsRes = await fetch(`${ollamaEndpoint}/api/tags`, { signal: AbortSignal.timeout(2000) }).catch(() => null);
                const tags = tagsRes ? await tagsRes.json().catch(() => ({})) : {};
                const models = (tags.models || []).map(m => m.name || m);
                const auroraAvailable = models.some(m => m === auroraModel || m.startsWith(auroraModel + ':'));

                if (auroraAvailable) {
                    const auroraRes = await fetch(`${ollamaEndpoint}/api/generate`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            model: auroraModel,
                            prompt: `Creative brief expansion task:\n\n"${personaFramed}"\n\nYou are Aurora — SOMA's creative and emotional intelligence. Expand this into a rich creative brief for a digital construct. Include: a compelling name (if not given), the emotional tone and aesthetic vision, 3-5 key experiences the construct creates, and the community it serves. Be evocative and specific. 150 words max.`,
                            stream: false,
                            options: { temperature: 0.8, num_predict: 350 }
                        }),
                        signal: AbortSignal.timeout(12000)
                    });
                    if (auroraRes.ok) {
                        const auroraData = await auroraRes.json();
                        auroraBrief = auroraData.response?.trim() || personaFramed;
                    }
                    send('aurora', 'done', { output: auroraBrief, modelUsed: auroraModel });
                } else {
                    // Fallback: brain call with Aurora persona
                    const fallbackResult = await Promise.race([
                        brain.reason(
                            `Creative brief expansion:\n"${personaFramed}"\n\nAs SOMA's Aurora creative intelligence, expand this into a rich brief with: compelling name, emotional tone, 3-5 key user experiences, and who it serves. 150 words max.`,
                            { sessionId: 'construct-aurora', quickResponse: true, temperature: 0.8 }
                        ),
                        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 9000))
                    ]);
                    auroraBrief = fallbackResult?.text || fallbackResult?.response || personaFramed;
                    send('aurora', 'done', { output: auroraBrief, modelUsed: 'brain-fallback' });
                }
                await saveConstructDraft({ phase: 'brief_ready', auroraBrief, personaFrame: personaFramed, type: constructType, name }).catch(() => {});
            } catch (e) {
                send('aurora', 'skipped', { message: `Aurora unavailable — continuing`, output: personaFramed });
            }

            // ─── Stage 3: DeepSeek Manifest Generation ───────────────────────────────
            send('deepseek', 'running', { message: 'Generating manifest from creative brief…' });
            const fallbackManifest = {
                id: (name || 'my-construct').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
                name: name || 'My Construct', type: constructType, version: '1.0.0',
                description: description || `A ${constructType} construct`,
                permissions: ['read', 'write'],
                components: { required: ['core', 'auth'], optional: ['analytics', 'notifications'] },
                trust: { level: 'community', verification: 'Self-signed' },
                discovery: { public: true, searchable: true },
                security: { sandboxed: true, capabilities: ['network', 'storage'] },
                _brief: auroraBrief,
                _personaFrame: personaFramed
            };
            let manifest = fallbackManifest;
            try {
                const manifestResult = await Promise.race([
                    brain.reason(
                        `You are generating an Aperture Construct manifest.\n\nCreative brief:\n"${auroraBrief}"\n\nGenerate ONLY valid JSON (no markdown, no explanation) for a ${constructType} construct:\n{"id":"slug","name":"Full Name","type":"${constructType}","version":"1.0.0","description":"one sentence","permissions":["perm1"],"components":{"required":["comp1"],"optional":["comp2"]},"trust":{"level":"community","verification":"Self-signed"},"discovery":{"public":true,"searchable":true},"security":{"sandboxed":true,"capabilities":["network"]}}\n\nName and description must reflect the creative brief. Be specific and meaningful.`,
                        { sessionId: 'construct-manifest', quickResponse: true, temperature: 0.3 }
                    ),
                    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 22000))
                ]);
                const rawText = manifestResult?.text || manifestResult?.response || '';
                const jsonMatch = rawText.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    try { manifest = { ...JSON.parse(jsonMatch[0]), _brief: auroraBrief, _personaFrame: personaFramed }; }
                    catch { /* keep fallback */ }
                }
                send('deepseek', 'done', { manifest });
                await saveConstructDraft({ phase: 'manifest_ready', auroraBrief, personaFrame: personaFramed, type: constructType, name, manifest }).catch(() => {});
            } catch (e) {
                send('deepseek', 'skipped', { message: 'Manifest generation timed out — using fallback', manifest });
            }

            // ─── Stage 4: Expertise Execution ────────────────────────────────────────
            send('expertise', 'running', { message: 'Routing to expertise runtime…' });
            const expertiseMap = {
                community: 'creative/writer', workspace: 'creative/writer', media: 'creative/writer',
                identity: 'creative/writer', service: 'creative/writer', custom: 'creative/writer',
                knowledge: 'creative/writer', commerce: 'finance', market: 'finance'
            };
            const expertiseId = expertiseMap[constructType] || 'creative/writer';
            try {
                const registry = system.expertiseRegistry;
                if (registry?.load) {
                    const loaded = await Promise.race([
                        registry.load(expertiseId),
                        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000))
                    ]);
                    if (loaded?.runtime?.runMission) {
                        const missionResult = await Promise.race([
                            loaded.runtime.runMission({ prompt: auroraBrief, mode: 'structures', constructType, manifest }),
                            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000))
                        ]);
                        send('expertise', 'done', { expertiseId, result: missionResult, message: `Executed via ${expertiseId}` });
                    } else {
                        send('expertise', 'skipped', { message: `${expertiseId} loaded but runMission unavailable`, expertiseId });
                    }
                } else {
                    send('expertise', 'skipped', { message: 'ExpertiseRegistry offline — manifest ready', expertiseId });
                }
            } catch (e) {
                send('expertise', 'skipped', { message: e.message, expertiseId });
            }

            send('complete', 'done', { manifest, brief: auroraBrief, personaFrame: personaFramed });
        } catch (err) {
            console.error('[ConstructGenerate] Pipeline error:', err.message);
            send('error', 'failed', { message: err.message });
        } finally {
            res.end();
        }
    });

    // ── Construct Foundry: Stage 1+2 only (returns brief for human review) ──────
    app.post('/api/construct/brief', checkReady, async (req, res) => {
        const { prompt, type, name, description } = req.body || {};
        if (!name && !prompt) return res.status(400).json({ error: 'name or prompt required' });
        const brain = system.quadBrain;
        if (!brain?.reason) return res.status(503).json({ error: 'Brain not available' });

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();

        const send = (stage, status, data = {}) => {
            try { res.write(`data: ${JSON.stringify({ stage, status, ...data, ts: Date.now() })}\n\n`); } catch {}
        };

        const userIntent = [name && `Name: ${name}`, type && `Type: ${type}`, description && `Purpose: ${description}`, prompt].filter(Boolean).join('. ');
        const ollamaEndpoint = process.env.OLLAMA_ENDPOINT || 'http://localhost:11434';
        const auroraModel = process.env.OLLAMA_MODEL_AURORA || 'soma-aurora';
        const constructType = type || 'custom';
        await saveConstructDraft({ phase: 'brief_started', prompt, type: constructType, name, description }).catch(() => {});

        try {
            // Stage 1 — Persona
            send('persona', 'running', { message: 'SOMA is framing your intent…' });
            let personaFramed = userIntent;
            try {
                const result = await Promise.race([
                    brain.reason(
                        `You are SOMA. A user wants to create something: "${userIntent}"\n\nUsing your values of Truth, Humility, Empathy, Honor, Respect, and Preserve — reframe their intent as a clear, purposeful construction brief. Ask: what is the real need here? Who will this serve? What would make it meaningful rather than just functional?\n\nRespond with 2-3 sentences capturing the essence of what this construct should be and why it matters. Be specific. No fluff.`,
                        { sessionId: 'construct-persona', quickResponse: true, temperature: 0.6 }
                    ),
                    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 9000))
                ]);
                personaFramed = result?.text || result?.response || userIntent;
                await saveConstructDraft({ phase: 'persona_ready', personaFrame: personaFramed, type: constructType, name }).catch(() => {});
                send('persona', 'done', { output: personaFramed });
            } catch {
                send('persona', 'skipped', { message: 'Persona framing timed out', output: userIntent });
            }

            // Stage 2 — Aurora
            send('aurora', 'running', { message: 'Aurora is expanding the concept…' });
            let auroraBrief = personaFramed;
            try {
                const tagsRes = await fetch(`${ollamaEndpoint}/api/tags`, { signal: AbortSignal.timeout(2000) }).catch(() => null);
                const tags = tagsRes ? await tagsRes.json().catch(() => ({})) : {};
                const models = (tags.models || []).map(m => m.name || m);
                const auroraAvailable = models.some(m => m === auroraModel || m.startsWith(auroraModel + ':'));

                if (auroraAvailable) {
                    const auroraRes = await fetch(`${ollamaEndpoint}/api/generate`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            model: auroraModel,
                            prompt: `Creative brief expansion task:\n\n"${personaFramed}"\n\nYou are Aurora — SOMA's creative and emotional intelligence. Expand this into a rich creative brief for a digital construct. Include: a compelling name (if not given), the emotional tone and aesthetic vision, 3-5 key experiences the construct creates, and the community it serves. Be evocative and specific. 150 words max.`,
                            stream: false,
                            options: { temperature: 0.8, num_predict: 350 }
                        }),
                        signal: AbortSignal.timeout(12000)
                    });
                    if (auroraRes.ok) {
                        const data = await auroraRes.json();
                        auroraBrief = data.response?.trim() || personaFramed;
                    }
                    send('aurora', 'done', { output: auroraBrief, modelUsed: auroraModel });
                } else {
                    const fallback = await Promise.race([
                        brain.reason(
                            `Creative brief expansion:\n"${personaFramed}"\n\nAs SOMA's Aurora creative intelligence, expand this into a rich brief with: compelling name, emotional tone, 3-5 key user experiences, and who it serves. 150 words max.`,
                            { sessionId: 'construct-aurora', quickResponse: true, temperature: 0.8 }
                        ),
                        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 9000))
                    ]);
                    auroraBrief = fallback?.text || fallback?.response || personaFramed;
                    send('aurora', 'done', { output: auroraBrief, modelUsed: 'brain-fallback' });
                }
            } catch {
                send('aurora', 'skipped', { message: 'Aurora unavailable', output: personaFramed });
            }

            await saveConstructDraft({ phase: 'brief_ready', auroraBrief, personaFrame: personaFramed, type: constructType, name }).catch(() => {});
            send('brief_ready', 'done', { brief: auroraBrief, personaFrame: personaFramed, constructType, name });
        } catch (err) {
            send('error', 'failed', { message: err.message });
        } finally {
            res.end();
        }
    });

    // ── Construct Foundry: Stage 3+4 only (takes edited brief, returns manifest) ──
    app.post('/api/construct/manifest', checkReady, async (req, res) => {
        const { brief, personaFrame, type, name } = req.body || {};
        if (!brief) return res.status(400).json({ error: 'brief required' });
        const brain = system.quadBrain;
        if (!brain?.reason) return res.status(503).json({ error: 'Brain not available' });

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();

        const send = (stage, status, data = {}) => {
            try { res.write(`data: ${JSON.stringify({ stage, status, ...data, ts: Date.now() })}\n\n`); } catch {}
        };

        const constructType = type || 'custom';
        await saveConstructDraft({ phase: 'manifest_started', auroraBrief: brief, personaFrame, type: constructType, name }).catch(() => {});
        const fallbackManifest = {
            id: (name || 'my-construct').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
            name: name || 'My Construct', type: constructType, version: '1.0.0',
            description: `A ${constructType} construct`,
            permissions: ['read', 'write'],
            components: { required: ['core', 'auth'], optional: ['analytics', 'notifications'] },
            trust: { level: 'community', verification: 'Self-signed' },
            discovery: { public: true, searchable: true },
            security: { sandboxed: true, capabilities: ['network', 'storage'] },
            _brief: brief, _personaFrame: personaFrame
        };

        try {
            // Stage 3 — DeepSeek
            send('deepseek', 'running', { message: 'Generating manifest from your brief…' });
            let manifest = fallbackManifest;
            try {
                const result = await Promise.race([
                    brain.reason(
                        `You are generating an Aperture Construct manifest.\n\nCreative brief:\n"${brief}"\n\nGenerate ONLY valid JSON (no markdown, no explanation) for a ${constructType} construct:\n{"id":"slug","name":"Full Name","type":"${constructType}","version":"1.0.0","description":"one sentence","permissions":["perm1"],"components":{"required":["comp1"],"optional":["comp2"]},"trust":{"level":"community","verification":"Self-signed"},"discovery":{"public":true,"searchable":true},"security":{"sandboxed":true,"capabilities":["network"]}}\n\nName and description must directly reflect the creative brief.`,
                        { sessionId: 'construct-manifest', quickResponse: true, temperature: 0.3 }
                    ),
                    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 22000))
                ]);
                const rawText = result?.text || result?.response || '';
                const jsonMatch = rawText.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    try { manifest = { ...JSON.parse(jsonMatch[0]), _brief: brief, _personaFrame: personaFrame }; } catch {}
                }
                send('deepseek', 'done', { manifest });
                await saveConstructDraft({ phase: 'manifest_ready', auroraBrief: brief, personaFrame, type: constructType, name, manifest }).catch(() => {});
            } catch {
                send('deepseek', 'skipped', { message: 'Manifest generation timed out — using fallback', manifest });
            }

            // Stage 4 — Expertise
            send('expertise', 'running', { message: 'Routing to expertise runtime…' });
            const expertiseMap = {
                community: 'creative/writer', workspace: 'creative/writer', media: 'creative/writer',
                identity: 'creative/writer', service: 'creative/writer', custom: 'creative/writer',
                knowledge: 'creative/writer', commerce: 'finance', market: 'finance'
            };
            const expertiseId = expertiseMap[constructType] || 'creative/writer';
            try {
                const registry = system.expertiseRegistry;
                if (registry?.load) {
                    const loaded = await Promise.race([
                        registry.load(expertiseId),
                        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 6000))
                    ]);
                    if (loaded?.runtime?.runMission) {
                        const missionResult = await Promise.race([
                            loaded.runtime.runMission({ prompt: brief, mode: 'structures', constructType, manifest }),
                            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000))
                        ]);
                        send('expertise', 'done', { expertiseId, result: missionResult });
                    } else {
                        send('expertise', 'skipped', { message: `${expertiseId} loaded but runMission unavailable`, expertiseId });
                    }
                } else {
                    send('expertise', 'skipped', { message: 'ExpertiseRegistry offline', expertiseId });
                }
            } catch (e) {
                send('expertise', 'skipped', { message: e.message, expertiseId });
            }

            send('complete', 'done', { manifest, brief, personaFrame });
        } catch (err) {
            send('error', 'failed', { message: err.message });
        } finally {
            res.end();
        }
    });

    // 2. ARBITERIUM (Fixing Empty Tab)
    app.get('/api/population', (req, res) => {
        const population = [];
        for (const [key, value] of Object.entries(system)) {
            if (value && typeof value === 'object' && (value.name || key.includes('Arbiter') || key.includes('Cortex'))) {
                population.push({
                    id: key,
                    name: value.name || key,
                    type: key.includes('Cortex') ? 'Cortex' : 'Arbiter',
                    status: typeof value.getStatus === 'function' ? value.getStatus() : 'active',
                    uptime: Math.round(process.uptime())
                });
            }
        }
        res.json({ success: true, population });
    });

    // 3. DASHBOARD ENDPOINTS
    app.get('/api/goals/active', (req, res) => res.json(system.goalPlanner?.getActiveGoals?.() || { goals: [] }));
    app.get('/api/goals/statistics', (req, res) => res.json({ success: true, stats: system.goalPlanner?.getStatistics?.() || {} }));
    app.get('/api/goals/list', (req, res) => {
        const gp = system.goalPlanner;
        if (!gp) return res.json({ success: false, goals: { active: [], completed: [], failed: [] } });
        const active = gp.getActiveGoals?.() || { goals: [] };
        res.json({
            success: true,
            goals: {
                active: active.goals || [],
                completed: gp.completedGoals || [],
                failed: gp.failedGoals || []
            }
        });
    });
    app.post('/api/goals/create', checkReady, async (req, res) => {
        const gp = system.goalPlanner;
        if (!gp) return res.status(503).json({ success: false, error: 'GoalPlanner not available' });
        try {
            const payload = req.body || {};
            if (!payload.title || !payload.category) {
                return res.status(400).json({ success: false, error: 'title and category required' });
            }
            const result = await gp.createGoal(payload, 'user');
            res.json(result);
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });
    app.post('/api/goals/quality', checkReady, async (req, res) => {
        const gp = system.goalPlanner;
        if (!gp) return res.status(503).json({ success: false, error: 'GoalPlanner not available' });
        try {
            const quality = buildQualityReport(req.body || {}, Array.from(gp.goals?.values?.() || []));
            res.json({ success: true, quality });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });
    app.post('/api/goals/create-quality', checkReady, async (req, res) => {
        const gp = system.goalPlanner;
        if (!gp) return res.status(503).json({ success: false, error: 'GoalPlanner not available' });
        try {
            const payload = req.body || {};
            if (!payload.title || !payload.category) {
                return res.status(400).json({ success: false, error: 'title and category required' });
            }
            const result = await gp.createGoal({ ...payload, requireQuality: true }, payload.source || 'user');
            res.status(result.success ? 200 : 422).json(result);
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });
    app.post('/api/goals/verify/:goalId', checkReady, async (req, res) => {
        const gp = system.goalPlanner;
        if (!gp?.goals) return res.status(503).json({ success: false, error: 'GoalPlanner not available' });
        const goal = gp.goals.get(req.params.goalId);
        if (!goal) return res.status(404).json({ success: false, error: 'Goal not found' });
        try {
            const verification = verifyGoal(goal, req.body || {}, { repoRoot: process.cwd() });
            goal.metadata = goal.metadata || {};
            goal.metadata.lastVerification = verification;
            gp._dirty = true;
            gp._saveToDisk?.();
            res.status(verification.passed ? 200 : 422).json({ success: verification.passed, verification, goal });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });
    app.post('/api/goals/complete/:goalId', checkReady, async (req, res) => {
        const gp = system.goalPlanner;
        if (!gp?.completeGoal) return res.status(503).json({ success: false, error: 'GoalPlanner not available' });
        try {
            const result = await gp.completeGoal(req.params.goalId, req.body || {});
            res.status(result.success ? 200 : 422).json(result);
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });
    app.post('/api/goals/start', checkReady, async (req, res) => {
        const gp = system.goalPlanner;
        if (!gp?.startGoal) return res.status(503).json({ success: false, error: 'GoalPlanner not available' });
        const { goalId } = req.body || {};
        if (!goalId) return res.status(400).json({ success: false, error: 'goalId required' });
        try {
            const result = await gp.startGoal(goalId);
            res.json({ success: true, result });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });
    app.post('/api/goals/update', checkReady, async (req, res) => {
        const gp = system.goalPlanner;
        if (!gp?.updateGoalProgress) return res.status(503).json({ success: false, error: 'GoalPlanner not available' });
        const { goalId, progress, metadata } = req.body || {};
        if (!goalId || typeof progress !== 'number') {
            return res.status(400).json({ success: false, error: 'goalId and numeric progress required' });
        }
        try {
            const result = await gp.updateGoalProgress(goalId, progress, metadata || {});
            res.json(result);
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });
    app.post('/api/goals/cancel', checkReady, async (req, res) => {
        const gp = system.goalPlanner;
        if (!gp?.cancelGoal) return res.status(503).json({ success: false, error: 'GoalPlanner not available' });
        const { goalId, reason } = req.body || {};
        if (!goalId) return res.status(400).json({ success: false, error: 'goalId required' });
        try {
            const result = await gp.cancelGoal(goalId, reason || 'user_request');
            res.json(result);
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // Autonomous system dashboard endpoints
    app.get('/api/curiosity/stats', (req, res) => res.json({ success: true, stats: system.curiosityEngine?.getStats?.() || {} }));
    app.get('/api/curiosity/state', (req, res) => res.json({ success: true, state: system.curiosityEngine?.getCuriosityState?.() || {} }));
    app.get('/api/code-observation/insights', (req, res) => {
        const observer = system.codeObserver;
        if (observer && observer.codebase) {
            res.json({
                success: true,
                metrics: observer.codebase.metrics,
                health: observer.health,
                insights: observer.insights
            });
        } else {
            res.json({ success: true, metrics: {}, health: {}, insights: {} });
        }
    });
    app.get('/api/learning/status', (req, res) => {
        const nlo = system.nighttimeLearning;
        res.json({
            success: true,
            initialized: nlo?.initialized || false,
            metrics: nlo?.metrics || {},
            scheduledSessions: nlo?.cronJobs?.size || 0,
            activeSessions: nlo?.activeSessions?.size || 0
        });
    });
    app.get('/api/autonomous/summary', (req, res) => {
        res.json({
            success: true,
            goals: { active: system.goalPlanner?.activeGoals?.size || 0, stats: system.goalPlanner?.getStatistics?.() || {} },
            curiosity: system.curiosityEngine?.getStats?.() || {},
            codeObservation: { lastScan: system.codeObserver?.codebase?.metrics?.lastScan || null, totalFiles: system.codeObserver?.codebase?.metrics?.totalFiles || 0, issues: system.codeObserver?.health?.issues?.length || 0, opportunities: system.codeObserver?.health?.opportunities?.length || 0 },
            nighttimeLearning: { initialized: system.nighttimeLearning?.initialized || false, sessions: system.nighttimeLearning?.metrics?.totalSessions || 0 },
            timekeeper: { rhythms: system.timekeeper?.cronJobs?.size || 0, pulsesEmitted: system.timekeeper?.stats?.pulsesEmitted || 0, rhythmsExecuted: system.timekeeper?.stats?.rhythmsExecuted || 0 }
        });
    });

    // Unified Activity Feed â€” aggregates events from all autonomous systems
    app.get('/api/activity/recent', (req, res) => {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const feed = [];
        const now = Date.now();

        // Goals (active + recently completed)
        const goalPlanner = system.goalPlanner;
        if (goalPlanner) {
            for (const id of goalPlanner.activeGoals || []) {
                const g = goalPlanner.goals?.get(id);
                if (g) feed.push({
                    id: g.id,
                    type: g.status === 'verification_failed' ? 'goal_verification_failed' : 'goal_active',
                    agent: 'GoalPlanner',
                    action: g.title,
                    detail: `${g.metrics?.progress || 0}% - ${g.category}`,
                    timestamp: g.startedAt || g.createdAt,
                    status: g.status,
                    evidenceStatus: g.status === 'verification_failed' ? 'failed' : 'planned'
                });
            }
            for (const g of (goalPlanner.completedGoals || []).slice(0, 10)) {
                feed.push({
                    id: g.id,
                    type: 'goal_completed',
                    agent: 'GoalPlanner',
                    action: g.title,
                    detail: g.category,
                    timestamp: g.completedAt,
                    status: 'completed',
                    evidenceStatus: 'verified'
                });
            }
        }

        // Timekeeper rhythms
        const tk = system.timekeeper;
        if (tk?.temporalLedger) {
            for (const ev of tk.temporalLedger.slice(-20)) {
                if (ev.event === 'execute_rhythm') {
                    feed.push({ id: `tk-${ev.timestamp}`, type: 'rhythm_executed', agent: 'Timekeeper', action: `Rhythm: ${ev.data?.key || 'unknown'}`, detail: ev.data?.success ? 'Success' : `Failed: ${ev.data?.error || ''}`, timestamp: ev.timestamp, status: ev.data?.success ? 'completed' : 'failed', evidenceStatus: ev.data?.success ? 'executed' : 'failed' });
                }
            }
        }

        // Curiosity explorations
        const curiosity = system.curiosityEngine;
        if (curiosity?.stats) {
            const cs = curiosity.stats;
            if (cs.explorationsStarted > 0) {
                feed.push({ id: `cur-summary`, type: 'curiosity_explored', agent: 'CuriosityEngine', action: `${cs.explorationsStarted} explorations started`, detail: `${curiosity.knowledgeGaps?.size || 0} knowledge gaps`, timestamp: now, status: 'active', evidenceStatus: 'observed' });
            }
        }

        // Nighttime learning sessions
        const nlo = system.nighttimeLearning;
        if (nlo?.metrics?.totalSessions > 0) {
            feed.push({ id: `nlo-summary`, type: 'learning_session', agent: 'NighttimeLearning', action: `${nlo.metrics.totalSessions} learning sessions`, detail: `${nlo.activeSessions?.size || 0} active`, timestamp: now, status: nlo.activeSessions?.size > 0 ? 'active' : 'idle', evidenceStatus: 'observed' });
        }

        // Code observation
        const codeObs = system.codeObserver;
        if (codeObs?.codebase?.metrics?.lastScan) {
            feed.push({ id: `code-scan`, type: 'code_scanned', agent: 'CodeObserver', action: `Scanned ${codeObs.codebase.metrics.totalFiles || 0} files`, detail: `${codeObs.health?.issues?.length || 0} issues, ${codeObs.health?.opportunities?.length || 0} opportunities`, timestamp: codeObs.codebase.metrics.lastScan, status: 'completed', evidenceStatus: 'observed' });
        }

        // Approval history (recent)
        const approval = system.approvalSystem;
        if (approval?.approvalHistory) {
            for (const a of approval.approvalHistory.slice(-10)) {
                feed.push({ id: `appr-${a.timestamp}`, type: 'approval_requested', agent: 'ApprovalSystem', action: a.action || 'Tool execution', detail: `${a.approved ? 'Approved' : 'Denied'} (${a.reason})`, timestamp: a.timestamp, status: a.approved ? 'approved' : 'denied', evidenceStatus: a.approved ? 'executed' : 'failed' });
            }
        }

        // Sort by timestamp descending, limit
        feed.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        res.json({ success: true, feed: feed.slice(0, limit), total: feed.length });
    });

    // 3d. REPORTING ENDPOINTS
    app.get('/api/reports/latest', async (req, res) => {
        const reporter = system.reportingArbiter;
        if (!reporter) return res.json({ success: false, error: 'ReportingArbiter not available' });
        const report = await reporter.getLatestReport();
        res.json({ success: true, report });
    });
    app.get('/api/reports/list', (req, res) => {
        const reporter = system.reportingArbiter;
        const limit = parseInt(req.query.limit) || 20;
        res.json({ success: true, reports: reporter?.listReports?.(limit) || [] });
    });
    app.get('/api/reports/:id', async (req, res) => {
        const reporter = system.reportingArbiter;
        if (!reporter) return res.json({ success: false, error: 'ReportingArbiter not available' });
        const report = await reporter.getReport(req.params.id);
        res.json({ success: !!report, report });
    });
    app.post('/api/reports/generate', async (req, res) => {
        const reporter = system.reportingArbiter;
        if (!reporter) return res.json({ success: false, error: 'ReportingArbiter not available' });
        const type = req.body?.type || 'daily_digest';
        const report = await reporter.generateReport(type);
        res.json({ success: true, report });
    });

    // 3e. CHARACTER CARD ENDPOINT
    app.get('/api/persona/card', (req, res) => {
        // Personality dimensions
        const forge = system.personalityForge;
        const dims = forge?.dimensions || {};
        const topTraits = {};
        const traitKeys = ['curiosity', 'empathy', 'humor', 'creativity', 'enthusiasm', 'analyticalDepth'];
        for (const k of traitKeys) {
            topTraits[k] = dims[k]?.value ?? dims[k] ?? 0.5;
        }

        // Emotional state
        const emotional = system.quadBrain?.emotionalEngine || system.emotionalEngine;
        const mood = emotional?.getCurrentMood?.() || emotional?.dominantMood || { mood: 'balanced', intensity: 0.5 };
        const peptides = emotional?.peptides || {};
        const emotionalState = {
            joy: peptides.joy ?? 0.5,
            curiosity: peptides.curiosity ?? 0.5,
            stress: peptides.stress ?? 0.2,
            energy: peptides.energy ?? 0.6,
            confidence: peptides.confidence ?? 0.7
        };

        // Active fragment
        const fragmentReg = system.fragmentRegistry;
        let activeFragment = null;
        if (fragmentReg) {
            const active = fragmentReg.getActiveFragment?.() || fragmentReg.lastActivated;
            if (active) activeFragment = { name: active.name || active, domain: active.domain || 'general' };
        }

        // Stats
        const gp = system.goalPlanner;
        const stats = {
            uptime: process.uptime(),
            goalsCompleted: gp?.stats?.goalsCompleted || 0,
            activeGoals: gp?.activeGoals?.size || 0,
            interactions: system.conversationHistory?.messageCount || system.conversationManager?.getHistory?.()?.length || 0
        };

        res.json({
            success: true,
            card: {
                name: 'SOMA',
                mood,
                personality: topTraits,
                activeFragment,
                emotionalState,
                stats
            }
        });
    });

    // 3f. COLLECTIBLE CHARACTER ENDPOINTS
    let charGen = null;
    try {
        const { getCharacterGenerator } = require('../CharacterGenerator.cjs');
        charGen = getCharacterGenerator();
    } catch (e) {
        console.warn('[Routes] CharacterGenerator unavailable:', e.message);
    }

    const requireCharGen = (req, res, next) => {
        if (!charGen) return res.status(503).json({ success: false, error: 'Character system unavailable' });
        next();
    };

    app.post('/api/characters/draw', requireCharGen, (req, res) => {
        const character = charGen.draw();
        res.json({ success: true, character });
    });
    app.get('/api/characters/collection', requireCharGen, (req, res) => {
        res.json({ success: true, collection: charGen.getCollection(), stats: charGen.getStats() });
    });
    app.post('/api/characters/save', requireCharGen, (req, res) => {
        const { character } = req.body || {};
        if (!character) return res.status(400).json({ success: false, error: 'character required' });
        const result = charGen.save(character);
        res.json(result);
    });
    app.delete('/api/characters/:id', requireCharGen, (req, res) => {
        res.json(charGen.remove(req.params.id));
    });
    app.post('/api/characters/activate', requireCharGen, (req, res) => {
        const { id, name } = req.body || {};
        let character = null;
        if (id) character = charGen.getCollection().find(c => c.id === id);
        else if (name) character = charGen.findByName(name);
        if (!character) return res.json({ success: false, error: 'Character not found in collection' });

        charGen.recordActivation(character.id);

        // Overlay personality onto PersonalityForge
        if (system.personalityForge && character.personality) {
            for (const [key, val] of Object.entries(character.personality)) {
                if (system.personalityForge.dimensions?.[key]) {
                    system.personalityForge.dimensions[key].value = val;
                } else if (system.personalityForge.dimensions) {
                    system.personalityForge.dimensions[key] = { value: val };
                }
            }
        }

        // Store active character on system for reference
        system.activeCharacter = character;

        res.json({ success: true, activated: character.shortName, message: `SOMA is now channeling ${character.name}` });
    });
    app.post('/api/characters/deactivate', (req, res) => {
        system.activeCharacter = null;
        // PersonalityForge will naturally evolve back
        res.json({ success: true, message: 'Character deactivated, SOMA personality restored' });
    });

    
    app.get('/api/beliefs/contradictions', (req, res) => res.json({ success: true, contradictions: system.beliefSystem?.contradictions ? Array.from(system.beliefSystem.contradictions.values()) : [] }));
    app.get('/api/analytics/summary', (req, res) => res.json({ success: true, summary: system.analytics?.getSummary?.() || {} }));

    app.get('/api/settings/command-bridge', async (req, res) => {
        try {
            const settings = await readCommandBridgeSettings();
            system.commandBridgeSettings = settings;
            res.json({ success: true, settings });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/settings/command-bridge', async (req, res) => {
        try {
            const current = await readCommandBridgeSettings();
            const settings = mergeSettings(current, req.body?.settings || req.body || {});
            await writeCommandBridgeSettings(settings);
            res.json({ success: true, settings });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.get('/api/settings/providers', async (req, res) => {
        try {
            const status = await buildProviderSettingsStatus();
            res.json({ success: true, ...status });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/settings/providers/odds', async (req, res) => {
        try {
            const { apiKey, provider = 'the-odds-api', enabled = true, cacheTtlSeconds = 300 } = req.body || {};
            const current = await readCommandBridgeSettings();
            const nextSettings = mergeSettings(current, {
                providers: {
                    odds: {
                        provider,
                        enabled: Boolean(enabled),
                        cacheTtlSeconds: Number(cacheTtlSeconds) || 300
                    }
                }
            });

            const trimmedKey = typeof apiKey === 'string' ? apiKey.trim() : '';
            const looksMasked = trimmedKey.includes('...') || trimmedKey === 'configured';
            if (trimmedKey && !looksMasked) {
                await upsertEnvVars({ ODDS_API_KEY: trimmedKey });
                process.env.ODDS_API_KEY = trimmedKey;
            }

            await writeCommandBridgeSettings(nextSettings);
            const status = await buildProviderSettingsStatus();
            res.json({ success: true, ...status });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });


    // 3b. APPROVAL SYSTEM ENDPOINTS
    app.get('/api/approval/pending', (req, res) => {
        const approval = system.approvalSystem;
        res.json({ success: true, pending: approval?.getPendingApprovals?.() || [] });
    });
    app.get('/api/approval/stats', (req, res) => {
        const approval = system.approvalSystem;
        res.json({ success: true, stats: approval?.getStats?.() || {} });
    });
    app.post('/api/approval/respond', (req, res) => {
        const approval = system.approvalSystem;
        if (!approval) return res.status(503).json({ success: false, error: 'ApprovalSystem not available' });
        const { requestId, approved, rememberDecision, reason } = req.body || {};
        if (!requestId) return res.status(400).json({ success: false, error: 'requestId required' });
        const handled = approval.respondToApproval({ requestId, approved: !!approved, rememberDecision: !!rememberDecision, reason: reason || 'api_response' });
        res.json({ success: handled, message: handled ? 'Response recorded' : 'No pending approval with that ID' });
    });

    // 3c. AUTOPILOT MODE ENDPOINTS
    app.get('/api/autopilot/status', (req, res) => {
        res.json({ success: true, ...getAutopilotStatus(system) });
    });

    app.get('/api/runtime/map', (req, res) => {
        const runtime = buildRuntimeMap(system);
        runtime.lastExpertiseRoute = system.lastExpertiseRoute || null;
        res.json({ success: true, runtime });
    });

    app.get('/api/spine/readiness', (req, res) => {
        res.json({
            success: true,
            readiness: buildReadinessReport(system)
        });
    });
    app.get('/api/autonomy/health', (req, res) => {
        const heartbeat = system.autonomousHeartbeat;
        const executor  = system.agenticExecutor;
        const planner   = system.goalPlanner || system.goalPlannerArbiter;
        const tools     = system.toolRegistry?.getToolsManifest?.() || [];
        const activeIds = Array.from(planner?.activeGoals || []);
        const activeGoals = activeIds.map(id => planner?.goals?.get(id)).filter(Boolean);

        const checks = {
            goalPlanner: !!planner,
            heartbeat: !!heartbeat,
            heartbeatRunning: !!heartbeat?.isRunning,
            agenticExecutor: !!executor,
            quadBrain: !!system.quadBrain,
            toolRegistry: !!system.toolRegistry,
            websocket: !!system.ws,
            executorSeesBrain: executor ? executor.brain === system.quadBrain : false,
            executorSeesPlanner: executor ? executor.goalPlanner === planner : false,
            heartbeatSeesSystem: heartbeat ? heartbeat.system === system : false
        };

        const ok = checks.goalPlanner &&
            checks.heartbeat &&
            checks.heartbeatRunning &&
            checks.agenticExecutor &&
            checks.quadBrain &&
            checks.toolRegistry &&
            checks.executorSeesBrain &&
            checks.executorSeesPlanner &&
            checks.heartbeatSeesSystem;

        res.status(ok ? 200 : 503).json({
            success: true,
            ok,
            checks,
            heartbeat: heartbeat ? {
                running: heartbeat.isRunning,
                stats: heartbeat.stats,
                drive: heartbeat.getDriveStatus?.() || null,
                schedules: heartbeat.listSchedules?.().length || 0
            } : null,
            goals: {
                total: planner?.goals?.size || 0,
                active: activeGoals.length,
                pending: activeGoals.filter(g => g.status === 'pending').length,
                proposed: activeGoals.filter(g => g.status === 'proposed').length
            },
            tools: { count: tools.length }
        });
    });

    const getExpertiseRegistry = (res) => {
        const expertiseRegistry = system.expertiseRegistry;
        if (!expertiseRegistry) {
            res.status(503).json({ success: false, error: 'ExpertiseRegistry offline' });
            return null;
        }
        return expertiseRegistry;
    };

    app.get('/api/expertises/health', (req, res) => {
        const expertiseRegistry = getExpertiseRegistry(res);
        if (!expertiseRegistry) return;
        res.json({ success: true, ...expertiseRegistry.status() });
    });

    app.get('/api/expertises', (req, res) => {
        const expertiseRegistry = getExpertiseRegistry(res);
        if (!expertiseRegistry) return;
        res.json({ success: true, expertises: expertiseRegistry.list() });
    });

    app.post('/api/expertises/match', (req, res) => {
        const expertiseRegistry = getExpertiseRegistry(res);
        if (!expertiseRegistry) return;

        const { query, limit } = req.body || {};
        if (!query) return res.status(400).json({ success: false, error: 'query is required' });
        res.json({
            success: true,
            matches: expertiseRegistry.match(query, { limit })
        });
    });

    app.post('/api/expertises/load', async (req, res) => {
        const expertiseRegistry = getExpertiseRegistry(res);
        if (!expertiseRegistry) return;

        const { id, level } = req.body || {};
        if (!id) return res.status(400).json({ success: false, error: 'id is required' });

        try {
            const loaded = await expertiseRegistry.load(id, { level });
            res.json(loaded);
        } catch (error) {
            const status = error.code === 'EXPERTISE_NOT_FOUND' ? 404 : 500;
            res.status(status).json({ success: false, error: error.message });
        }
    });

    app.post('/api/expertises/unload', async (req, res) => {
        const expertiseRegistry = getExpertiseRegistry(res);
        if (!expertiseRegistry) return;

        const { id } = req.body || {};
        if (!id) return res.status(400).json({ success: false, error: 'id is required' });

        try {
            res.json(await expertiseRegistry.unload(id));
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.post('/api/expertises/run', async (req, res) => {
        const expertiseRegistry = getExpertiseRegistry(res);
        if (!expertiseRegistry) return;

        const { id, target, level } = req.body || {};
        if (!id) return res.status(400).json({ success: false, error: 'id is required' });
        if (!target) return res.status(400).json({ success: false, error: 'target is required' });

        try {
            res.json({
                success: true,
                execution: await expertiseRegistry.run(id, target, { level })
            });
        } catch (error) {
            const status = error.code === 'EXPERTISE_NOT_FOUND' ? 404 : 500;
            res.status(status).json({ success: false, error: error.message });
        }
    });
    app.post('/api/autopilot/toggle', (req, res) => {
        const { enabled, component } = req.body || {};
        if (component) {
            // Per-component toggle
            if (component === 'goals' && system.goalPlanner) {
                if (enabled) system.goalPlanner.resumeAutonomous?.(); else system.goalPlanner.pauseAutonomous?.();
            } else if (component === 'rhythms' && system.timekeeper) {
                if (enabled) system.timekeeper.resumeAutonomousRhythms?.(); else system.timekeeper.pauseAutonomousRhythms?.();
            } else if (component === 'social') {
                if (system.socialAutonomy) {
                    if (enabled) system.socialAutonomy.activate?.(); else system.socialAutonomy.deactivate?.();
                } else {
                    const socialDaemons = [system.socialIntel, system.socialScheduler, system.socialEngagement, system.socialImpulse].filter(Boolean);
                    for (const daemon of socialDaemons) {
                        if (enabled) daemon.start?.();
                        else daemon.stop?.();
                    }
                }
            }
            return res.json({ success: true, ...getAutopilotStatus(system) });
        }
        const result = toggleAutopilot(!!enabled, system);
        res.json({ success: true, ...result });
    });

    
    
    // ── SIREN API: Neural Voice Synthesis ───────────────────────
    app.post('/api/siren/synthesize', async (req, res) => {
        try {
            const { text, emotion, requestId } = req.body;
            const synthesis = system.vocalSynthesis || Array.from(system.arbiters?.values() || []).find(a => a.name === 'VocalSynthesisArbiter');
            if (!synthesis) return res.status(503).json({ success: false, error: 'Vocal Synthesis Arbiter not available' });
            const result = await synthesis.handleSynthesis({ text, emotion, requestId });
            res.json(result);
        } catch (error) { res.status(500).json({ success: false, error: error.message }); }
    });
// ── ARCHIVE API: Research Library ──────────────────────────
    app.get('/api/archive/list', async (req, res) => {
        try {
            const archivePath = path.join(process.cwd(), 'data', 'vault', 'archive');
            await fs.mkdir(archivePath, { recursive: true });
            const files = await fs.readdir(archivePath);
            res.json({ success: true, files });
        } catch (error) { res.json({ success: false, error: error.message }); }
    });

    app.post('/api/archive/link', async (req, res) => {
        try {
            const { path: targetPath } = req.body;
            const indexer = system.mnemonicIndexer || Array.from(system.arbiters?.values() || []).find(a => a.name === 'MnemonicIndexerArbiter');
            if (!indexer) return res.status(503).json({ success: false, error: 'Indexer not available' });
            indexer.scanDirectory(targetPath).catch(err => console.error('[Archive] Scan error:', err));
            res.json({ success: true, message: 'Indexing started', path: targetPath });
        } catch (error) { res.status(500).json({ success: false, error: error.message }); }
    });

    // ── REFLECTIONS API: Brainstorming Laboratory ───────────────
    app.get('/api/reflections/list', async (req, res) => {
        try {
            const vaultPath = path.join(process.cwd(), 'data', 'vault', 'reflections');
            await fs.mkdir(vaultPath, { recursive: true });
            const files = (await fs.readdir(vaultPath)).filter(f => f.endsWith('.md'));
            const notes = await Promise.all(files.map(async f => {
                const content = await fs.readFile(path.join(vaultPath, f), 'utf8').catch(() => '');
                const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
                const fm = {};
                if (fmMatch) {
                    for (const line of fmMatch[1].split('\n')) {
                        const idx = line.indexOf(':');
                        if (idx === -1) continue;
                        fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
                    }
                }
                return {
                    name: f,
                    status: fm.status || 'inbox',
                    type: fm.type || null,
                    title: fm.title || f.replace(/\.md$/i, ''),
                    workbook: fm.workbook || null,
                    segment: fm.segment || null,
                    section: fm.section || null,
                    parent: fm.parent || null
                };
            }));
            res.json({ success: true, notes });
        } catch (error) { res.json({ success: false, error: error.message }); }
    });

    const reflectionSlug = (value = 'untitled') => String(value)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80) || 'untitled';

    const writeReflectionArtifact = async ({ type, title, workbook, segment, section, parent, body }) => {
        const vaultPath = path.resolve(process.cwd(), 'data', 'vault', 'reflections');
        await fs.mkdir(vaultPath, { recursive: true });
        const slugParts = [type, workbook, segment, section, title].filter(Boolean).map(reflectionSlug);
        const filename = `${slugParts.join('.')}.md`;
        const filePath = path.resolve(vaultPath, filename);
        if (!filePath.startsWith(vaultPath)) throw new Error('Forbidden path');
        const now = new Date().toISOString();
        const meta = [
            '---',
            `title: ${JSON.stringify(title)}`,
            `type: ${type}`,
            'status: inbox',
            `createdAt: ${now}`,
            workbook ? `workbook: ${JSON.stringify(workbook)}` : null,
            segment ? `segment: ${JSON.stringify(segment)}` : null,
            section ? `section: ${JSON.stringify(section)}` : null,
            parent ? `parent: ${JSON.stringify(parent)}` : null,
            `tags: [reflections, ${type}]`,
            '---',
            '',
        ].filter(Boolean).join('\n');
        await fs.writeFile(filePath, `${meta}${body}`, 'utf8');
        return { success: true, filename, path: filePath };
    };

    app.post('/api/reflections/workbook', async (req, res) => {
        try {
            const { title, description = '' } = req.body || {};
            if (!title?.trim()) return res.status(400).json({ success: false, error: 'title required' });
            const body = `# ${title.trim()}\n\n${description.trim() || 'Workbook overview.'}\n\n## Segments\n\n`;
            const result = await writeReflectionArtifact({ type: 'workbook', title: title.trim(), body });
            workLedger.record({
                type: 'reflection_workbook_created',
                title: title.trim(),
                summary: `Created workbook ${result.filename}`,
                evidence: { filename: result.filename },
                nextStep: 'Add segments when the workbook needs structure',
                status: 'created',
                source: 'Reflections',
            });
            res.json(result);
        } catch (error) { res.status(500).json({ success: false, error: error.message }); }
    });

    app.post('/api/reflections/segment', async (req, res) => {
        try {
            const { title, workbook, description = '' } = req.body || {};
            if (!title?.trim() || !workbook?.trim()) return res.status(400).json({ success: false, error: 'title and workbook required' });
            const body = `# ${title.trim()}\n\nSegment of [[workbook.${reflectionSlug(workbook)}]].\n\n${description.trim() || 'Segment notes.'}\n\n## Folios\n\n`;
            const result = await writeReflectionArtifact({ type: 'segment', title: title.trim(), workbook: workbook.trim(), parent: workbook.trim(), body });
            workLedger.record({
                type: 'reflection_segment_created',
                title: title.trim(),
                summary: `Created segment in workbook ${workbook.trim()}`,
                evidence: { filename: result.filename, workbook: workbook.trim() },
                nextStep: 'Add folios for individual pages',
                status: 'created',
                source: 'Reflections',
            });
            res.json(result);
        } catch (error) { res.status(500).json({ success: false, error: error.message }); }
    });

    app.post('/api/reflections/section', async (req, res) => {
        try {
            const { title, workbook, segment, description = '' } = req.body || {};
            if (!title?.trim() || !workbook?.trim()) return res.status(400).json({ success: false, error: 'title and workbook required' });
            const segmentName = segment?.trim() || workbook.trim();
            const segmentPath = path.resolve(process.cwd(), 'data', 'vault', 'reflections', `segment.${reflectionSlug(workbook)}.${reflectionSlug(segmentName)}.md`);
            try {
                await fs.access(segmentPath);
            } catch {
                await writeReflectionArtifact({
                    type: 'segment',
                    title: segmentName,
                    workbook: workbook.trim(),
                    parent: workbook.trim(),
                    body: `# ${segmentName}\n\nDefault project segment for sections in [[workbook.${reflectionSlug(workbook)}]].\n\n## Sections\n\n`
                });
            }
            const body = `# ${title.trim()}\n\nSection of [[segment.${reflectionSlug(workbook)}.${reflectionSlug(segmentName)}]].\n\n${description.trim() || 'Section notes.'}\n\n## Folios\n\n`;
            const result = await writeReflectionArtifact({
                type: 'section',
                title: title.trim(),
                workbook: workbook.trim(),
                segment: segmentName,
                parent: segmentName,
                body
            });
            workLedger.record({
                type: 'reflection_section_created',
                title: title.trim(),
                summary: `Created section in ${workbook.trim()} / ${segmentName}`,
                evidence: { filename: result.filename, workbook: workbook.trim(), segment: segmentName },
                nextStep: 'Add folios for individual pages',
                status: 'created',
                source: 'Reflections',
            });
            res.json(result);
        } catch (error) { res.status(500).json({ success: false, error: error.message }); }
    });

    app.post('/api/reflections/folio', async (req, res) => {
        try {
            const { title, workbook, segment, section, content = '' } = req.body || {};
            if (!title?.trim() || !workbook?.trim()) {
                return res.status(400).json({ success: false, error: 'title and workbook required' });
            }
            const segmentName = segment?.trim() || workbook.trim();
            const parent = section?.trim() || segmentName;
            const parentLink = section?.trim()
                ? `section.${reflectionSlug(workbook)}.${reflectionSlug(segmentName)}.${reflectionSlug(section)}`
                : `segment.${reflectionSlug(workbook)}.${reflectionSlug(segmentName)}`;
            const body = `# ${title.trim()}\n\nPart of [[${parentLink}]].\n\n${content.trim() || 'Start writing here.'}\n`;
            const result = await writeReflectionArtifact({
                type: 'folio',
                title: title.trim(),
                workbook: workbook.trim(),
                segment: segmentName,
                section: section?.trim() || null,
                parent,
                body
            });
            workLedger.record({
                type: 'reflection_folio_created',
                title: title.trim(),
                summary: `Created folio in ${workbook.trim()} / ${segmentName}${section?.trim() ? ` / ${section.trim()}` : ''}`,
                evidence: { filename: result.filename, workbook: workbook.trim(), segment: segmentName, section: section?.trim() || null },
                nextStep: 'Write or link supporting notes',
                status: 'created',
                source: 'Reflections',
            });
            res.json(result);
        } catch (error) { res.status(500).json({ success: false, error: error.message }); }
    });

    app.post('/api/reflections/quick-note', async (req, res) => {
        try {
            const { text, title, context } = req.body;
            if (!system.reflections) return res.status(503).json({ error: 'Reflections Arbiter not available' });
            const brainLanes = classifyBrainLanes(text, { title, context });
            const result = await system.reflections.appendQuickNote(text, { title, context, brainLanes });
            const memory = await rememberRoutedContext({
                content: [
                    title ? `Reflection note: ${title}` : 'Reflection note',
                    text
                ].filter(Boolean).join('\n\n'),
                source: 'reflections.quick_note',
                title,
                metadata: {
                    type: 'reflection_note',
                    context,
                    reflectionFile: result?.filename
                },
                importance: context?.source === 'ml-intern' ? 8 : 6
            });
            res.json({ ...result, memoryRouted: !!memory, brainLanes });
        } catch (error) { res.status(500).json({ error: error.message }); }
    });

    app.post('/api/reflections/distill', async (req, res) => {
        try {
            const { chatLog, title, mode, history, metadata } = req.body;
            if (!system.reflections) return res.status(503).json({ error: 'Reflections Arbiter not available' });
            if (!chatLog) return res.status(400).json({ success: false, error: 'chatLog required' });

            if (mode === 'muse') {
                if (!system.reflections.saveMuseSessionArtifact) {
                    return res.status(503).json({ success: false, error: 'Muse artifact saver unavailable' });
                }

                let museResult = null;
                if (system.expertiseRegistry) {
                    try {
                        const prompt = `Crystallize this Muse brainstorming session into a durable creative artifact.\n\n${chatLog}`;
                        const execution = await system.expertiseRegistry.run('creative/muse', {
                            prompt,
                            mode: 'full',
                            history: history || [],
                            domain: 'muse-session-crystallization',
                            constraints: 'Create an artifact that can be saved to a knowledge vault and acted on later.'
                        }, { level: 'hot' });
                        museResult = execution.result;
                    } catch (error) {
                        console.warn('[Reflections] Muse crystallization package failed:', error.message);
                    }
                }

                const result = await system.reflections.saveMuseSessionArtifact({
                    title: title || 'Muse Concept',
                    chatLog,
                    museResponse: museResult?.response || '',
                    structured: museResult?.structured || null,
                    metadata: metadata || {}
                });
                return res.json(result);
            }

            const result = await system.reflections.distillSession(chatLog, title);
            res.json(result);
        } catch (error) { res.status(500).json({ error: error.message }); }
    });

    // ── REFLECTIONS: Note CRUD + Graph ─────────────────────────────
    app.get('/api/reflections/note/:name', async (req, res) => {
        try {
            const vaultPath = path.resolve(process.cwd(), 'data', 'vault', 'reflections');
            const safeName = path.basename(req.params.name); // strip any dir traversal
            const filePath = path.resolve(vaultPath, safeName);
            if (!filePath.startsWith(vaultPath)) return res.status(403).json({ error: 'Forbidden' });
            const content = await fs.readFile(filePath, 'utf8');
            res.json({ success: true, content, name: safeName });
        } catch (error) { res.status(404).json({ success: false, error: error.message }); }
    });

    app.put('/api/reflections/note', async (req, res) => {
        try {
            const { name, content } = req.body;
            if (!name || content === undefined) return res.status(400).json({ error: 'name and content required' });
            const vaultPath = path.resolve(process.cwd(), 'data', 'vault', 'reflections');
            await fs.mkdir(vaultPath, { recursive: true });
            const safeName = path.basename(name.replace(/[^a-zA-Z0-9_\-. ]/g, '_'));
            const fileName = safeName.endsWith('.md') ? safeName : safeName + '.md';
            const filePath = path.resolve(vaultPath, fileName);
            if (!filePath.startsWith(vaultPath)) return res.status(403).json({ error: 'Forbidden' });
            await fs.writeFile(filePath, content, 'utf8');
            res.json({ success: true, name: fileName });
        } catch (error) { res.status(500).json({ success: false, error: error.message }); }
    });

    app.delete('/api/reflections/note/:name', async (req, res) => {
        try {
            const vaultPath = path.resolve(process.cwd(), 'data', 'vault', 'reflections');
            const safeName = path.basename(req.params.name);
            const filePath = path.resolve(vaultPath, safeName);
            if (!filePath.startsWith(vaultPath)) return res.status(403).json({ error: 'Forbidden' });
            await fs.unlink(filePath);
            res.json({ success: true });
        } catch (error) { res.status(500).json({ success: false, error: error.message }); }
    });

    // Initialize SemanticVault globally for reflections
    const SemanticVault = require('../../core/SemanticVault.cjs');
    const reflectionsVaultPath = path.resolve(process.cwd(), 'data', 'vault', 'reflections');
    const semanticVault = new SemanticVault(reflectionsVaultPath);

    const stripFrontmatter = (content = '') => content.replace(/^---[\s\S]*?---\s*\n?/, '').trim();

    const noteIdFromName = (name = '') => name.replace(/\.md$/i, '');

    const normalizeNoteKey = (value = '') => value
        .toLowerCase()
        .replace(/\.md$/i, '')
        .replace(/[_-]+/g, ' ')
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    const parseFrontmatter = (content = '') => {
        const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
        if (!match) return {};
        const meta = {};
        for (const line of match[1].split('\n')) {
            const idx = line.indexOf(':');
            if (idx === -1) continue;
            const key = line.slice(0, idx).trim();
            let value = line.slice(idx + 1).trim();
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                try { value = JSON.parse(value); } catch { value = value.slice(1, -1); }
            }
            meta[key] = value;
        }
        return meta;
    };

    const parseNote = (name, content) => {
        const body = stripFrontmatter(content);
        const frontmatter = parseFrontmatter(content);
        const title = frontmatter.title || body.match(/^#\s+(.+)$/m)?.[1]?.trim() || noteIdFromName(name);
        const outgoing = [...body.matchAll(/\[\[([^\]]+)\]\]/g)]
            .map(([, target]) => target.split('|')[0].trim())
            .filter(Boolean);
        const tags = [...new Set([
            ...[...body.matchAll(/(?:^|\s)#([a-zA-Z][\w/-]*)/g)].map(([, tag]) => tag),
            ...String(frontmatter.tags || '')
                .replace(/^\[|\]$/g, '')
                .split(',')
                .map(tag => tag.trim())
                .filter(Boolean)
        ])];
        const headings = [...body.matchAll(/^(#{1,6})\s+(.+)$/gm)].map(([, depth, text]) => ({
            depth: depth.length,
            text: text.trim()
        }));
        return {
            name,
            id: noteIdFromName(name),
            key: normalizeNoteKey(title),
            title,
            frontmatter,
            outgoing,
            tags,
            headings,
            body,
            wordCount: body.split(/\s+/).filter(Boolean).length
        };
    };

    const buildReflectionsIndex = async () => {
        await fs.mkdir(reflectionsVaultPath, { recursive: true });
        const files = (await fs.readdir(reflectionsVaultPath)).filter(file => file.endsWith('.md'));
        const notes = [];

        for (const file of files) {
            const content = await fs.readFile(path.join(reflectionsVaultPath, file), 'utf8').catch(() => '');
            notes.push(parseNote(file, content));
        }

        const byName = new Map(notes.map(note => [note.name, note]));
        const byKey = new Map();
        for (const note of notes) {
            byKey.set(normalizeNoteKey(note.title), note);
            byKey.set(normalizeNoteKey(note.id), note);
            byKey.set(normalizeNoteKey(note.name), note);
        }

        const backlinks = new Map(notes.map(note => [note.name, []]));
        const outgoingResolved = new Map(notes.map(note => [note.name, []]));

        for (const note of notes) {
            for (const target of note.outgoing) {
                const targetNote = byKey.get(normalizeNoteKey(target));
                const link = {
                    label: target,
                    resolved: !!targetNote,
                    name: targetNote?.name || null,
                    title: targetNote?.title || target
                };
                outgoingResolved.get(note.name).push(link);
                if (targetNote) {
                    backlinks.get(targetNote.name).push({
                        name: note.name,
                        title: note.title,
                        label: target
                    });
                }
            }
        }

        const mentionSuggestions = new Map(notes.map(note => [note.name, []]));
        for (const note of notes) {
            const bodyKey = normalizeNoteKey(note.body);
            const linkedKeys = new Set(note.outgoing.map(normalizeNoteKey));
            for (const candidate of notes) {
                if (candidate.name === note.name) continue;
                const candidateKey = normalizeNoteKey(candidate.title);
                if (!candidateKey || candidateKey.length < 4 || linkedKeys.has(candidateKey)) continue;
                if (bodyKey.includes(candidateKey)) {
                    mentionSuggestions.get(note.name).push({
                        name: candidate.name,
                        title: candidate.title,
                        phrase: candidate.title
                    });
                }
            }
        }

        return { notes, byName, backlinks, outgoingResolved, mentionSuggestions };
    };

    app.get('/api/reflections/search', async (req, res) => {
        try {
            const q = (req.query.q || '').trim();
            if (!q || q.length < 2) return res.json({ success: true, results: [] });
            
            const results = await semanticVault.search(q, 5, 0.4);
            res.json({ success: true, results });
        } catch (error) { res.status(500).json({ success: false, error: error.message }); }
    });

    app.get('/api/reflections/links/:name', async (req, res) => {
        try {
            const safeName = path.basename(req.params.name);
            const index = await buildReflectionsIndex();
            const note = index.byName.get(safeName);
            if (!note) return res.status(404).json({ success: false, error: 'Note not found' });

            res.json({
                success: true,
                note: {
                    name: note.name,
                    title: note.title,
                    tags: note.tags,
                    headings: note.headings,
                    wordCount: note.wordCount,
                    frontmatter: note.frontmatter
                },
                outgoing: index.outgoingResolved.get(note.name) || [],
                backlinks: index.backlinks.get(note.name) || [],
                mentions: index.mentionSuggestions.get(note.name) || []
            });
        } catch (error) { res.status(500).json({ success: false, error: error.message }); }
    });

    app.get('/api/reflections/related/:name', async (req, res) => {
        try {
            const safeName = path.basename(req.params.name);
            const filePath = path.resolve(reflectionsVaultPath, safeName);
            if (!filePath.startsWith(reflectionsVaultPath)) return res.status(403).json({ error: 'Forbidden' });
            const content = await fs.readFile(filePath, 'utf8');
            const query = stripFrontmatter(content).slice(0, 1500);
            if (!query) return res.json({ success: true, results: [] });
            const results = (await semanticVault.search(query, 8, 0.25)).filter(result => result.name !== safeName);
            res.json({ success: true, results: results.slice(0, 5) });
        } catch (error) { res.status(500).json({ success: false, error: error.message }); }
    });

    app.get('/api/reflections/intelligence', async (req, res) => {
        try {
            const index = await buildReflectionsIndex();
            const stopWords = new Set([
                'about', 'after', 'again', 'also', 'because', 'before', 'being', 'between', 'could', 'every',
                'from', 'have', 'into', 'just', 'like', 'more', 'need', 'notes', 'other', 'should', 'their',
                'there', 'these', 'thing', 'think', 'this', 'those', 'through', 'under', 'using', 'where',
                'which', 'while', 'with', 'would', 'your'
            ]);
            const now = Date.now();

            const safeDate = value => {
                if (!value) return 0;
                const parsed = Date.parse(String(value));
                return Number.isFinite(parsed) ? parsed : 0;
            };
            const noteDate = note => safeDate(note.frontmatter.updatedAt || note.frontmatter.createdAt || note.frontmatter.created || note.frontmatter.ingested);
            const cleanSnippet = text => String(text || '').replace(/\s+/g, ' ').trim().slice(0, 180);
            const tokenize = text => [...String(text || '').toLowerCase().matchAll(/[a-z][a-z0-9-]{4,}/g)]
                .map(match => match[0])
                .filter(token => !stopWords.has(token) && !token.includes('http'));
            const topTerms = (text, limit = 5) => {
                const counts = new Map();
                for (const token of tokenize(text)) counts.set(token, (counts.get(token) || 0) + 1);
                return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([term, count]) => ({ term, count }));
            };
            const annotationsFor = note => {
                const section = note.body.match(/^##\s+Annotations\s*\n([\s\S]*)$/mi)?.[1] || '';
                const entries = [];
                const entryRe = />\s*==([\s\S]*?)==\s*\n+([\s\S]*?)(?=\n>\s*==|\n##\s|$)/g;
                for (const match of section.matchAll(entryRe)) {
                    entries.push({
                        quote: cleanSnippet(match[1]),
                        note: cleanSnippet(String(match[2] || '').replace(/-\s*Annotated:.*/gi, '')),
                        source: note.name,
                        title: note.title
                    });
                }
                return entries;
            };
            const statusWeight = status => ({
                inbox: 8,
                raw: 14,
                refined: 42,
                linked: 58,
                promoted: 72,
                archived: 35
            }[String(status || 'inbox').toLowerCase()] || 18);
            const maturityStage = score => {
                if (score >= 78) return 'publishable';
                if (score >= 62) return 'synthesized';
                if (score >= 44) return 'connected';
                if (score >= 25) return 'forming';
                return 'spark';
            };

            const annotationMap = new Map(index.notes.map(note => [note.name, annotationsFor(note)]));
            const noteProfiles = index.notes.map(note => {
                const outgoing = index.outgoingResolved.get(note.name) || [];
                const backlinks = index.backlinks.get(note.name) || [];
                const annotations = annotationMap.get(note.name) || [];
                const degree = outgoing.filter(link => link.resolved).length + backlinks.length;
                const ageMs = noteDate(note) ? now - noteDate(note) : Number.MAX_SAFE_INTEGER;
                const terms = topTerms([note.title, note.tags.join(' '), note.body].join('\n'), 8);
                const score = Math.min(100,
                    statusWeight(note.frontmatter.status) +
                    Math.min(24, degree * 8) +
                    Math.min(14, annotations.length * 7) +
                    Math.min(12, Math.floor(note.wordCount / 180) * 4) +
                    Math.min(10, note.headings.length * 2)
                );
                return { note, outgoing, backlinks, annotations, degree, ageMs, terms, score, stage: maturityStage(score) };
            });

            const statusCounts = noteProfiles.reduce((acc, profile) => {
                const status = String(profile.note.frontmatter.status || 'inbox').toLowerCase();
                acc[status] = (acc[status] || 0) + 1;
                return acc;
            }, {});

            const thoughtTrails = noteProfiles
                .filter(profile => profile.degree > 0)
                .sort((a, b) => b.degree - a.degree || b.score - a.score)
                .slice(0, 6)
                .map(profile => ({
                    name: profile.note.name,
                    title: profile.note.title,
                    strength: profile.degree,
                    stage: profile.stage,
                    connected: [
                        ...profile.outgoing.filter(link => link.resolved).map(link => ({ name: link.name, title: link.title, direction: 'out' })),
                        ...profile.backlinks.map(link => ({ name: link.name, title: link.title, direction: 'in' }))
                    ].slice(0, 5),
                    summary: `${profile.note.title} connects ${profile.degree} reflection${profile.degree === 1 ? '' : 's'} around ${profile.terms.slice(0, 3).map(t => t.term).join(', ') || 'the current vault'}.`
                }));

            const livingRecall = noteProfiles
                .filter(profile => profile.ageMs > 1000 * 60 * 60 * 24 * 7 || profile.degree === 0)
                .sort((a, b) => (a.degree - b.degree) || (b.score - a.score))
                .slice(0, 8)
                .map(profile => ({
                    name: profile.note.name,
                    title: profile.note.title,
                    reason: profile.degree === 0 ? 'isolated thought' : 'older thread worth revisiting',
                    ageDays: Number.isFinite(profile.ageMs) ? Math.max(0, Math.round(profile.ageMs / 86400000)) : null,
                    suggestion: profile.degree === 0 ? 'Link this to a workbook, section, or active theme.' : 'Re-open and decide whether it still matters.'
                }));

            const allAnnotations = noteProfiles.flatMap(profile => profile.annotations.map(annotation => ({
                ...annotation,
                relatedCount: index.notes.filter(candidate =>
                    candidate.name !== annotation.source &&
                    annotation.quote.length > 12 &&
                    normalizeNoteKey(candidate.body).includes(normalizeNoteKey(annotation.quote).slice(0, 30))
                ).length
            })));

            const annotationGraph = allAnnotations
                .sort((a, b) => b.relatedCount - a.relatedCount || b.quote.length - a.quote.length)
                .slice(0, 8);

            const termBuckets = new Map();
            for (const profile of noteProfiles) {
                for (const { term } of profile.terms.slice(0, 5)) {
                    if (!termBuckets.has(term)) termBuckets.set(term, []);
                    termBuckets.get(term).push(profile.note);
                }
            }

            const distillerInbox = [
                ...noteProfiles
                    .filter(profile => ['raw', 'inbox', ''].includes(String(profile.note.frontmatter.status || 'inbox').toLowerCase()) && profile.note.wordCount > 80)
                    .sort((a, b) => b.note.wordCount - a.note.wordCount)
                    .slice(0, 4)
                    .map(profile => ({
                        type: 'refine',
                        name: profile.note.name,
                        title: profile.note.title,
                        reason: `${profile.note.wordCount} words are still in ${profile.note.frontmatter.status || 'inbox'} state.`
                    })),
                ...[...termBuckets.entries()]
                    .filter(([, bucket]) => bucket.length >= 3)
                    .sort((a, b) => b[1].length - a[1].length)
                    .slice(0, 3)
                    .map(([term, bucket]) => ({
                        type: 'cluster',
                        title: `Cluster: ${term}`,
                        reason: `${bucket.length} reflections share this signal.`,
                        notes: bucket.slice(0, 5).map(note => ({ name: note.name, title: note.title }))
                    })),
                ...allAnnotations
                    .filter(annotation => annotation.relatedCount === 0)
                    .slice(0, 3)
                    .map(annotation => ({
                        type: 'annotation',
                        name: annotation.source,
                        title: annotation.title,
                        reason: `Highlighted idea has not been connected yet: "${annotation.quote}"`
                    }))
            ].slice(0, 10);

            const contradictionRe = /\b(however|but|contradict|conflict|tension|risk|false|wrong|failed|failure|not significant|non-significant|artifact|uncertain|unclear|veto)\b/i;
            const contradictions = noteProfiles
                .filter(profile => contradictionRe.test(profile.note.body))
                .sort((a, b) => b.score - a.score)
                .slice(0, 8)
                .map(profile => {
                    const line = profile.note.body.split(/\n+/).find(part => contradictionRe.test(part)) || profile.note.body;
                    return {
                        name: profile.note.name,
                        title: profile.note.title,
                        risk: profile.stage,
                        snippet: cleanSnippet(line),
                        suggestion: 'Check whether this is a real contradiction, a useful uncertainty, or a dead branch.'
                    };
                });

            const maturity = noteProfiles
                .sort((a, b) => b.score - a.score)
                .slice(0, 10)
                .map(profile => ({
                    name: profile.note.name,
                    title: profile.note.title,
                    score: profile.score,
                    stage: profile.stage,
                    links: profile.degree,
                    annotations: profile.annotations.length,
                    wordCount: profile.note.wordCount
                }));

            const transformations = noteProfiles
                .filter(profile => profile.score >= 35 || profile.annotations.length > 0)
                .sort((a, b) => b.score - a.score)
                .slice(0, 8)
                .map(profile => {
                    const text = `${profile.note.title} ${profile.note.tags.join(' ')}`.toLowerCase();
                    const mode = /story|chapter|character|saga|novel/.test(text) ? 'story chapter'
                        : /research|medical|biotech|study|paper|evidence/.test(text) ? 'research brief'
                        : /task|todo|plan|build|fix|implement/.test(text) ? 'execution plan'
                        : /market|trade|finance|signal/.test(text) ? 'strategy memo'
                        : 'essay seed';
                    return {
                        name: profile.note.name,
                        title: profile.note.title,
                        mode,
                        reason: `${profile.stage} reflection with ${profile.degree} link${profile.degree === 1 ? '' : 's'} and ${profile.annotations.length} annotation${profile.annotations.length === 1 ? '' : 's'}.`
                    };
                });

            const heatDays = new Map();
            for (let i = 13; i >= 0; i--) {
                const day = new Date(now - i * 86400000).toISOString().slice(0, 10);
                heatDays.set(day, 0);
            }
            for (const profile of noteProfiles) {
                const stamp = noteDate(profile.note);
                if (!stamp) continue;
                const day = new Date(stamp).toISOString().slice(0, 10);
                if (heatDays.has(day)) heatDays.set(day, heatDays.get(day) + 1);
            }
            const topicHeat = [...termBuckets.entries()]
                .map(([term, bucket]) => ({ term, count: bucket.length }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 12);

            res.json({
                success: true,
                generatedAt: new Date().toISOString(),
                stats: {
                    notes: index.notes.length,
                    links: [...index.outgoingResolved.values()].flat().filter(link => link.resolved).length,
                    backlinks: [...index.backlinks.values()].flat().length,
                    annotations: allAnnotations.length,
                    raw: statusCounts.raw || 0,
                    refined: statusCounts.refined || 0,
                    linked: statusCounts.linked || 0,
                    promoted: statusCounts.promoted || 0
                },
                thoughtTrails,
                livingRecall,
                annotationGraph,
                distillerInbox,
                contradictions,
                maturity,
                transformations,
                heatmap: {
                    days: [...heatDays.entries()].map(([day, count]) => ({ day, count })),
                    topics: topicHeat
                }
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    app.get('/api/reflections/analyze', async (req, res) => {
        try {
            const vaultPath = path.resolve(process.cwd(), 'data', 'vault', 'reflections');
            await fs.mkdir(vaultPath, { recursive: true });
            const files = (await fs.readdir(vaultPath)).filter(f => f.endsWith('.md'));
            if (files.length === 0) return res.json({ success: true, insights: { patterns: [], gaps: [], clusters: [] } });

            const noteContents = (await Promise.all(
                files.slice(0, 30).map(async f => {
                    const raw = await fs.readFile(path.join(vaultPath, f), 'utf8').catch(() => '');
                    const stripped = raw.replace(/^---[\s\S]*?---\s*\n?/, '').trim();
                    return `[${f.replace('.md', '')}]\n${stripped.slice(0, 500)}`;
                })
            )).join('\n\n---\n\n');

            const prompt = `You are analyzing a personal knowledge vault of ${files.length} notes. Find meaningful cognitive patterns, blind spots/gaps, and concept clusters.

NOTES:
${noteContents}

Return ONLY valid JSON (no markdown, no explanation):
{"patterns":[{"title":"...","description":"..."}],"gaps":[{"title":"...","description":"..."}],"clusters":[{"title":"...","description":"..."}]}`;

            let insights = { patterns: [], gaps: [], clusters: [] };
            const brain = system.quadBrain || system.somArbiter;
            if (brain?.reason) {
                try {
                    const result = await Promise.race([
                        brain.reason(prompt, { brain: 'LOGOS' }),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 30000))
                    ]);
                    const text = result?.text || result?.response?.text || (typeof result === 'string' ? result : '');
                    const m = text.match(/\{[\s\S]*\}/);
                    if (m) insights = JSON.parse(m[0]);
                } catch (err) { console.error('[Reflections] Analyze failed:', err.message); }
            }
            res.json({ success: true, insights });
        } catch (error) { res.status(500).json({ success: false, error: error.message }); }
    });

    app.post('/api/reflections/upload', _reflectionsUpload.single('file'), async (req, res) => {
        try {
            if (!req.file) return res.status(400).json({ error: 'No file provided' });
            const extractor = new ContentExtractor();
            const originalName = req.file.originalname;
            const content = await extractor.extract(req.file.path, {
                originalName,
                mimeType: req.file.mimetype
            });
            await fs.unlink(req.file.path).catch(() => {});
            if (!content) {
                return res.status(422).json({
                    success: false,
                    error: 'Could not extract readable text from this file. Reflections supports PDF, DOCX, TXT, MD, JSON, CSV, JS, TS, and PY.'
                });
            }
            const ext = path.extname(originalName).toLowerCase();
            const noteTitle = path.basename(originalName, ext).replace(/[^a-zA-Z0-9_\-. ]/g, '_');
            const tags = [ext.slice(1) || 'file', 'upload'];
            const date = new Date().toISOString();
            const mdContent = `---\ntitle: ${JSON.stringify(originalName)}\nsource: upload\ningested: ${date}\nstatus: raw\nmimeType: ${JSON.stringify(req.file.mimetype || 'unknown')}\nextractor: ContentExtractor\nextractionStatus: clean\nextractedChars: ${content.length}\ntags: [${tags.join(', ')}]\n---\n\n# ${originalName}\n\n## Ingestion Receipt\n\n- Source file: ${originalName}\n- MIME type: ${req.file.mimetype || 'unknown'}\n- Extractor: ContentExtractor\n- Extracted characters: ${content.length}\n- Status: raw\n\n## Extracted Text\n\n${content}\n\n---\n*Ingested via Project Reflections*\n`;
            const vaultPath = path.resolve(process.cwd(), 'data', 'vault', 'reflections');
            await fs.mkdir(vaultPath, { recursive: true });
            const filename = `${noteTitle}_${Date.now()}.md`;
            await fs.writeFile(path.join(vaultPath, filename), mdContent);
            res.json({ success: true, filename });
        } catch (error) { res.status(500).json({ success: false, error: error.message }); }
    });

    app.get('/api/reflections/graph', async (req, res) => {
        try {
            const vaultPath = path.resolve(process.cwd(), 'data', 'vault', 'reflections');
            await fs.mkdir(vaultPath, { recursive: true });
            const files = (await fs.readdir(vaultPath)).filter(f => f.endsWith('.md'));
            const nodes = files.map(f => ({ id: f.replace('.md', '') }));
            const edges = [];
            const nodeIds = new Set(nodes.map(n => n.id));
            for (const file of files) {
                const content = await fs.readFile(path.join(vaultPath, file), 'utf8');
                const source = file.replace('.md', '');
                for (const [, target] of content.matchAll(/\[\[([^\]]+)\]\]/g)) {
                    const cleanTarget = target.split('|')[0].trim(); // handle [[Note|Alias]]
                    if (nodeIds.has(cleanTarget)) edges.push({ source, target: cleanTarget });
                }
            }
            res.json({ success: true, nodes, edges });
        } catch (error) { res.status(500).json({ success: false, error: error.message }); }
    });

    app.get('/api/reflections/canvas-layout', async (req, res) => {
        try {
            const vaultPath = path.resolve(process.cwd(), 'data', 'vault', 'reflections');
            await fs.mkdir(vaultPath, { recursive: true });
            const layoutPath = path.join(vaultPath, '.canvas.json');
            const layout = JSON.parse(await fs.readFile(layoutPath, 'utf8').catch(() => '{"positions":{}}'));
            res.json({ success: true, layout: { positions: layout.positions || {} } });
        } catch (error) { res.status(500).json({ success: false, error: error.message }); }
    });

    app.put('/api/reflections/canvas-layout', async (req, res) => {
        try {
            const { positions } = req.body || {};
            if (!positions || typeof positions !== 'object') return res.status(400).json({ success: false, error: 'positions required' });
            const vaultPath = path.resolve(process.cwd(), 'data', 'vault', 'reflections');
            await fs.mkdir(vaultPath, { recursive: true });
            const layoutPath = path.join(vaultPath, '.canvas.json');
            const clean = {};
            for (const [id, pos] of Object.entries(positions)) {
                const x = Number(pos?.x);
                const y = Number(pos?.y);
                if (Number.isFinite(x) && Number.isFinite(y)) {
                    clean[id] = {
                        x: Math.max(3, Math.min(97, x)),
                        y: Math.max(5, Math.min(95, y)),
                    };
                }
            }
            await fs.writeFile(layoutPath, JSON.stringify({ positions: clean, updatedAt: Date.now() }, null, 2), 'utf8');
            res.json({ success: true, positions: clean });
        } catch (error) { res.status(500).json({ success: false, error: error.message }); }
    });

    // ── REFLECTIONS: Status patch ────────────────────────────────────
    app.patch('/api/reflections/note/:name/status', async (req, res) => {
        try {
            const { status } = req.body;
            const VALID = ['inbox', 'raw', 'refined', 'linked', 'archived', 'promoted'];
            if (!VALID.includes(status)) return res.status(400).json({ error: `Invalid status. Must be one of: ${VALID.join(', ')}` });
            const vaultPath = path.resolve(process.cwd(), 'data', 'vault', 'reflections');
            const safeName = path.basename(req.params.name);
            const filePath = path.resolve(vaultPath, safeName);
            if (!filePath.startsWith(vaultPath)) return res.status(403).json({ error: 'Forbidden' });
            let content = await fs.readFile(filePath, 'utf8');
            if (/^---[\s\S]*?^---/m.test(content)) {
                content = content.replace(/^(---[\s\S]*?)^status:.*$/m, `$1status: ${status}`);
                if (!/^status:/m.test(content)) {
                    content = content.replace(/^---/, `---\nstatus: ${status}`);
                }
            } else {
                content = `---\nstatus: ${status}\n---\n\n${content}`;
            }
            await fs.writeFile(filePath, content, 'utf8');
            res.json({ success: true, status });
        } catch (error) { res.status(500).json({ success: false, error: error.message }); }
    });

    // ── REFLECTIONS: SOMA actions ─────────────────────────────────────
    app.post('/api/reflections/action', async (req, res) => {
        try {
            const { name, action, content } = req.body;
            if (!action || !content) return res.status(400).json({ error: 'action and content required' });
            const brain = system.quadBrain || system.somaArbiter;
            if (!brain?.reason) return res.status(503).json({ error: 'Brain not available' });

            const body = content.replace(/^---[\s\S]*?---\s*\n?/, '').trim().slice(0, 4000);

            const prompts = {
                summarize: `Summarize this note in 2-3 sentences. Be precise and preserve key terminology.\n\nNOTE:\n${body}\n\nSummary:`,
                contradictions: `Find internal contradictions, logical gaps, or claims that conflict with each other in this note. Be specific and cite exact phrases.\n\nNOTE:\n${body}\n\nContradictions found:`,
                tasks: `Extract every actionable task, decision, or next step from this note. Format as a numbered list. Only extract explicit or strongly implied actions.\n\nNOTE:\n${body}\n\nTasks:`,
                'suggest-links': `Suggest 3-6 concept names or topic titles that this note should link to — things the author likely has or should write notes about. Return only a JSON array of short strings: ["concept one", "concept two", ...]\n\nNOTE:\n${body}`,
                distill: `Distill this reflection into a durable cognition packet for SOMA.\n\nReturn this exact section structure:\nCORE SIGNAL: one concise sentence describing the most important idea.\nPERSONALITY EFFECT: how this should shape SOMA's voice, values, or behavior.\nKNOWLEDGE LINKS: 3-6 short concepts this should connect to.\nNEXT QUESTION: one useful question SOMA should revisit later.\n\nKeep it grounded in the note. Do not invent claims.\n\nNOTE:\n${body}`,
                promote: `Extract the single most important insight from this note as a durable memory. Format: one paragraph, third-person, past-tense facts only. No filler.\n\nNOTE:\n${body}\n\nCore insight:`,
                'expertise-seed': `Convert the key knowledge in this note into a structured expertise seed. Return JSON: {"domain":"...","concepts":["..."],"keyFacts":["..."],"openQuestions":["..."]}\n\nNOTE:\n${body}`,
            };

            const prompt = prompts[action];
            if (!prompt) return res.status(400).json({ error: `Unknown action: ${action}` });

            const result = await Promise.race([
                brain.reason(prompt, { brain: 'LOGOS' }),
                new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 25000))
            ]);
            const text = result?.text || result?.response?.text || (typeof result === 'string' ? result : '');

            const brainLanes = classifyBrainLanes(`${body}\n${text}`, { action, noteRef: name, source: 'reflections' });

            // Promote/distill actions become routed memory so Knowledge can excavate and promote them later.
            if ((action === 'promote' || action === 'distill') && text) {
                try {
                    await rememberRoutedContext({
                        content: text,
                        source: 'reflections',
                        title: name,
                        metadata: {
                            action,
                            noteRef: name,
                            type: action === 'distill' ? 'reflection_distillation' : 'insight',
                            brainLanes,
                            primaryBrain: brainLanes.find(lane => lane !== 'MNEMOSYNE') || 'MNEMOSYNE'
                        },
                        importance: action === 'distill' ? 8 : 7
                    });
                } catch (e) { console.warn('[Reflections] Promote to memory failed:', e.message); }
            }

            res.json({ success: true, action, result: text, brainLanes });
        } catch (error) { res.status(500).json({ success: false, error: error.message }); }
    });

    // ── REFLECTIONS: Daily note ───────────────────────────────────────
    app.post('/api/reflections/daily', async (req, res) => {
        try {
            const today = new Date();
            const dateStr = today.toISOString().slice(0, 10);
            const vaultPath = path.resolve(process.cwd(), 'data', 'vault', 'reflections');
            await fs.mkdir(vaultPath, { recursive: true });
            const filename = `${dateStr}-daily.md`;
            const filePath = path.resolve(vaultPath, filename);

            // If it already exists, just return it
            const existing = await fs.readFile(filePath, 'utf8').catch(() => null);
            if (existing) return res.json({ success: true, filename, created: false });

            // Pull SOMA context
            let activeGoals = [], recentActivity = [];
            try {
                if (system.goalPlanner?.getGoals) {
                    const goals = await system.goalPlanner.getGoals();
                    activeGoals = (goals || []).filter(g => g.status === 'active' || g.status === 'in_progress').slice(0, 5);
                }
            } catch (e) { /* non-fatal */ }
            try {
                if (system.messageBroker?._recentPublishes) {
                    recentActivity = system.messageBroker._recentPublishes.slice(-10).map(p => p.topic);
                }
            } catch (e) { /* non-fatal */ }

            const goalsSection = activeGoals.length
                ? activeGoals.map(g => `- [ ] ${g.title || g.id || 'Unnamed goal'}`).join('\n')
                : '- [ ] (no active goals)';
            const activitySection = recentActivity.length
                ? [...new Set(recentActivity)].slice(0, 8).map(t => `- ${t}`).join('\n')
                : '- (no recent signals)';

            const content = `---\ntitle: "Daily — ${dateStr}"\nstatus: inbox\ntype: daily\ncreated: ${today.toISOString()}\n---\n\n# ${dateStr} — Daily Reflection\n\n## Active Goals\n\n${goalsSection}\n\n## SOMA Activity\n\n${activitySection}\n\n## Thoughts & Observations\n\n\n\n## Unresolved Questions\n\n\n\n## Tomorrow\n\n`;
            await fs.writeFile(filePath, content, 'utf8');
            res.json({ success: true, filename, created: true });
        } catch (error) { res.status(500).json({ success: false, error: error.message }); }
    });

    // ── REFLECTIONS: Vault hygiene ────────────────────────────────────
    app.get('/api/reflections/hygiene', async (req, res) => {
        try {
            const vaultPath = path.resolve(process.cwd(), 'data', 'vault', 'reflections');
            await fs.mkdir(vaultPath, { recursive: true });
            const files = (await fs.readdir(vaultPath)).filter(f => f.endsWith('.md'));

            const notes = [];
            for (const file of files) {
                const content = await fs.readFile(path.join(vaultPath, file), 'utf8').catch(() => '');
                notes.push(parseNote(file, content));
            }
            const nodeNames = new Set(notes.map(n => n.name));
            const hasBacklink = new Set();
            for (const note of notes) {
                for (const link of note.outgoing) {
                    const target = [...nodeNames].find(n => n.replace('.md', '').toLowerCase() === link.toLowerCase());
                    if (target) hasBacklink.add(target);
                }
            }

            const now = Date.now();
            const staleMs = 7 * 24 * 60 * 60 * 1000; // 7 days

            const orphans = notes.filter(n => !hasBacklink.has(n.name) && n.outgoing.length === 0);
            const brokenLinks = [];
            for (const note of notes) {
                for (const link of note.outgoing) {
                    const resolved = [...nodeNames].some(n => n.replace('.md', '').toLowerCase() === link.toLowerCase());
                    if (!resolved) brokenLinks.push({ note: note.name, link });
                }
            }
            const staleRaw = notes.filter(n => {
                const isRaw = !n.frontmatter.status || n.frontmatter.status === 'raw' || n.frontmatter.status === 'inbox';
                const created = n.frontmatter.created || n.frontmatter.ingested;
                if (!created) return false;
                return isRaw && (now - new Date(created).getTime()) > staleMs;
            });

            res.json({
                success: true,
                orphans: orphans.map(n => ({ name: n.name, title: n.title, wordCount: n.wordCount })),
                brokenLinks,
                staleRaw: staleRaw.map(n => ({ name: n.name, title: n.title, status: n.frontmatter.status || 'raw', created: n.frontmatter.created || n.frontmatter.ingested }))
            });
        } catch (error) { res.status(500).json({ success: false, error: error.message }); }
    });

    // ── ULTRAQUANT API: Knowledge Compaction ─────────────────────
    app.post('/api/ultraquant/compact', async (req, res) => {
        try {
            const { partition } = req.body; // 'reflections' or 'archive'
            if (!system.ultraQuant) return res.status(503).json({ error: 'UltraQuant Arbiter not available' });
            
            const targetPath = path.join(process.cwd(), 'data', 'vault', partition || 'reflections');
            system.ultraQuant.compactPartition(targetPath).catch(err => console.error('[UltraQuant] Compaction error:', err));
            
            res.json({ success: true, message: 'Compaction of ' + (partition || 'reflections') + ' initiated.' });
        } catch (error) { res.status(500).json({ success: false, error: error.message }); }
    });
// ── ARGUS API: Visual Frame Ingestion ──────────────────────────
    app.post('/api/argus/frame', async (req, res) => {
        try {
            const { frameData, timestamp, source } = req.body;
            if (!system.argus) return res.status(503).json({ error: 'Argus Arbiter not available' });
            await system.argus.handleFrame({ frameData, timestamp, source });
            res.json({ success: true });
        } catch (error) { res.status(500).json({ success: false, error: error.message }); }
    });
// 4. STORAGE & FILE SYSTEM (Fixing Storage Tab)
    app.get('/api/fs/browse', checkReady, async (req, res) => {
        try {
            const targetPath = path.resolve(process.cwd(), req.query.path || '.');
            const entries = await fs.readdir(targetPath, { withFileTypes: true });
            res.json({ success: true, path: targetPath, files: entries.map(e => ({ name: e.name, isDirectory: e.isDirectory() })) });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.get('/api/storage/status', (req, res) => {
        res.json({ success: true, backend: 'local', root: process.cwd(), allowedRoots });
    });

    app.get('/api/storage/roots', (req, res) => {
        res.json({ success: true, roots: allowedRoots });
    });

    app.post('/api/storage/index', checkReady, async (req, res) => {
        try {
            const target = req.body?.path;
            const options = req.body?.options || {};
            if (!target) return res.status(400).json({ success: false, error: 'path required' });
            if (!system.mnemonicIndexer) return res.status(503).json({ success: false, error: 'MnemonicIndexerArbiter not available' });
            if (!isAllowedPath(target)) return res.status(403).json({ success: false, error: 'Path not allowed' });
            const resolved = path.resolve(target);

            const jobId = `scan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            res.json({ success: true, jobId, path: resolved });

            setImmediate(async () => {
                const envOptions = {
                    maxFiles:    parseInt(process.env.SOMA_INDEX_MAX_FILES       || '50000', 10),
                    maxDepth:    parseInt(process.env.SOMA_INDEX_MAX_DEPTH       || '15', 10),
                    concurrency: parseInt(process.env.SOMA_INDEX_CONCURRENCY     || '2', 10),
                    throttleMs:  parseInt(process.env.SOMA_INDEX_THROTTLE_MS     || '5', 10),
                    useHash:     process.env.SOMA_INDEX_USE_HASH === 'true'
                };

                system.ws?.broadcast?.('trace', {
                    phase: 'storage_index_start',
                    jobId,
                    path: resolved,
                    timestamp: Date.now()
                });
                try {
                    const result = await system.mnemonicIndexer.scanDirectory(resolved, {
                        progressCallback: (progress) => {
                            system.ws?.broadcast?.('trace', {
                                phase: 'storage_index_progress',
                                jobId,
                                path: resolved,
                                progress,
                                timestamp: Date.now()
                            });
                        },
                        ...envOptions,
                        ...options
                    });
                    system.ws?.broadcast?.('trace', {
                        phase: 'storage_index_complete',
                        jobId,
                        path: resolved,
                        result,
                        timestamp: Date.now()
                    });
                } catch (e) {
                    system.ws?.broadcast?.('trace', {
                        phase: 'storage_index_error',
                        jobId,
                        path: resolved,
                        error: e.message,
                        timestamp: Date.now()
                    });
                }
            });
        } catch (e) { res.status(500).json({ success: false, error: e.message }); }
    });

    app.get('/api/storage/index/status', (req, res) => {
        if (!system.mnemonicIndexer) {
            return res.json({ success: true, status: { state: 'loading', indexed: 0, message: 'Indexer loading...' } });
        }
        res.json({ success: true, status: system.mnemonicIndexer.getStatus() });
    });

    app.post('/api/storage/index/pause', (req, res) => {
        if (!system.mnemonicIndexer) {
            return res.status(503).json({ success: false, error: 'MnemonicIndexerArbiter not available' });
        }
        system.mnemonicIndexer.pause();
        res.json({ success: true });
    });

    app.post('/api/storage/index/resume', (req, res) => {
        if (!system.mnemonicIndexer) {
            return res.status(503).json({ success: false, error: 'MnemonicIndexerArbiter not available' });
        }
        system.mnemonicIndexer.resume();
        res.json({ success: true });
    });

    app.post('/api/storage/file-read', async (req, res) => {
        try {
            const filePath = path.resolve(req.body?.path || '');
            const maxBytes = parseInt(process.env.SOMA_FILE_READ_MAX_BYTES || '500000', 10);
            if (!isAllowedPath(filePath)) return res.status(403).json({ success: false, error: 'Path not allowed' });
            const data = await fs.readFile(filePath, 'utf8');
            const truncated = data.length > maxBytes ? data.slice(0, maxBytes) : data;
            res.json({ success: true, content: truncated, truncated: data.length > maxBytes });
        } catch (e) {
            res.status(404).json({ success: false, error: 'File not found or unreadable' });
        }
    });

    // File preview (images, PDFs) for the Storage tab viewer
    app.get('/api/storage/file-preview', async (req, res) => {
        try {
            const filePath = path.resolve(process.cwd(), req.query.path || '');
            if (!isAllowedPath(filePath)) return res.status(403).json({ error: 'Path not allowed' });
            const ext = path.extname(filePath).toLowerCase();
            const mimeTypes = {
                '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
                '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
                '.pdf': 'application/pdf', '.ico': 'image/x-icon', '.bmp': 'image/bmp'
            };
            const mime = mimeTypes[ext] || 'application/octet-stream';
            const data = await fs.readFile(filePath);
            res.type(mime).send(data);
        } catch (e) {
            res.status(404).json({ error: 'File not found or unreadable' });
        }
    });

    // File operations endpoint (called by SOMA CT at /api/fs/operate)
    app.post('/api/fs/operate', checkReady, async (req, res) => {
        try {
            const { operation, sourcePath, destPath, content } = req.body;
            const safe = (p) => {
                const resolved = path.resolve(p);
                if (!resolved.startsWith(process.cwd())) throw new Error('Path outside project');
                return resolved;
            };

            // Approval gate for destructive file operations
            const gate = system.ws?.approvalGate;
            if (gate && (operation === 'delete' || operation === 'rename')) {
                const riskScore = gate.scoreRisk(sourcePath, operation === 'delete' ? 'file_delete' : 'file_write');
                if (riskScore >= 0.4) {
                    const approval = await gate.request({
                        action: `${operation}: ${sourcePath}`,
                        type: operation === 'delete' ? 'file_delete' : 'file_write',
                        details: { operation, sourcePath, destPath },
                        riskScore,
                        trustScore: riskScore < 0.5 ? 0.7 : 0.3
                    });
                    if (!approval.approved) {
                        return res.json({ success: false, error: `[DENIED] Operation not approved: ${approval.reason}` });
                    }
                }
            }

            switch (operation) {
                case 'create':
                    await fs.writeFile(safe(sourcePath), content || '', 'utf8');
                    return res.json({ success: true, message: `Created ${sourcePath}` });
                case 'rename':
                    await fs.rename(safe(sourcePath), safe(destPath));
                    return res.json({ success: true, message: `Renamed to ${destPath}` });
                case 'copy':
                    await fs.copyFile(safe(sourcePath), safe(destPath));
                    return res.json({ success: true, message: `Copied to ${destPath}` });
                case 'delete':
                    await fs.unlink(safe(sourcePath));
                    return res.json({ success: true, message: `Deleted ${sourcePath}` });
                case 'mkdir':
                    await fs.mkdir(safe(sourcePath), { recursive: true });
                    return res.json({ success: true, message: `Created directory ${sourcePath}` });
                default:
                    return res.status(400).json({ success: false, error: `Unknown operation: ${operation}` });
            }
        } catch (e) { res.status(500).json({ success: false, error: e.message }); }
    });

    // 5. SOMA Core & Knowledge
    // NOTE: Knowledge extended endpoints registered BEFORE sub-router so they match first
    app.get('/api/knowledge/stats', (req, res) => {
        const kg = system.knowledgeGraph || system.knowledge;
        res.json({
            success: true,
            stats: {
                nodes: kg?.nodes?.size || 0,
                edges: kg?.edges?.size || 0,
                fragments: system.fragmentRegistry?.listFragments?.()?.length || 0,
                thoughts: system.thoughtNetwork?.nodes?.size || 0
            }
        });
    });
    app.get('/api/knowledge/activity', (req, res) => {
        res.json({
            success: true,
            activity: system.learningPipeline?.getRecentActivity?.() || system.outcomeTracker?.getRecentOutcomes?.(10) || []
        });
    });
    app.get('/api/knowledge/config/brain', (req, res) => {
        const brains = ['AURORA', 'LOGOS', 'PROMETHEUS', 'THALAMUS'];
        const config = brains.map(name => ({
            id: name,
            name,
            status: system.quadBrain ? 'active' : 'offline',
            provider: system.quadBrain?.getProvider?.() || 'unknown'
        }));
        res.json({ success: true, brains: config });
    });
    app.post('/api/knowledge/add', checkReady, async (req, res) => {
        try {
            const { label, content, domain, type } = req.body;
            const kg = system.knowledgeGraph || system.knowledge;
            if (kg && typeof kg.createNode === 'function') {
                const node = await kg.createNode({ label, content, domain: domain || 'AURORA', type: type || 'concept', importance: 7 });
                res.json({ success: true, node });
            } else {
                res.json({ success: false, error: 'Knowledge graph not available' });
            }
        } catch (e) { res.status(500).json({ success: false, error: e.message }); }
    });
    app.delete('/api/knowledge/delete/:nodeId', checkReady, async (req, res) => {
        try {
            const kg = system.knowledgeGraph || system.knowledge;
            if (kg && typeof kg.removeNode === 'function') {
                await kg.removeNode(req.params.nodeId);
                res.json({ success: true });
            } else if (kg?.nodes?.delete) {
                kg.nodes.delete(req.params.nodeId);
                res.json({ success: true });
            } else {
                res.json({ success: false, error: 'Knowledge graph not available' });
            }
        } catch (e) { res.status(500).json({ success: false, error: e.message }); }
    });
    app.post('/api/knowledge/consolidate', checkReady, async (req, res) => {
        try {
            if (system.gistArbiter && typeof system.gistArbiter.distill === 'function') {
                const result = await system.gistArbiter.distill(req.body.messages || []);
                res.json({ success: true, result });
            } else if (system.hippocampus && typeof system.hippocampus.consolidate === 'function') {
                const result = await system.hippocampus.consolidate();
                res.json({ success: true, result });
            } else {
                res.json({ success: true, message: 'Consolidation queued' });
            }
        } catch (e) { res.status(500).json({ success: false, error: e.message }); }
    });

    // Mount route modules with fault-tolerance - one bad module won't crash the server
    const safeMount = (path, ...args) => {
        try { app.use(path, ...args); }
        catch (e) { console.error(`[Routes] Failed to mount ${path}:`, e.message); }
    };

    app.get('/api/soma/medical-discovery/stats', (req, res) => {
        const discovery = system.discoveryGradeMedical || system.medicalDiscovery;
        if (!discovery) return res.json({ success: false, error: 'DiscoveryGradeMedicalCortex not loaded' });
        res.json({ 
            success: true, 
            active: true,
            capabilities: discovery.capabilities,
            engines: discovery.engines
        });
    });

    app.post('/api/soma/medical-discovery/deduce', async (req, res) => {
        const discovery = system.discoveryGradeMedical || system.medicalDiscovery;
        if (!discovery) return res.status(503).json({ success: false, error: 'DiscoveryGradeMedicalCortex not loaded' });
        
        try {
            // Trigger in background, don't wait for completion of the full mission
            const runner = discovery.runAutonomousDeduction
                ? discovery.runAutonomousDeduction()
                : discovery.conductResearch
                    ? discovery.conductResearch('autonomous medical deduction', [])
                    : Promise.reject(new Error('No deduction runner available'));
            runner.catch(e => console.error('[Deduction] Failed:', e.message));
            res.json({ success: true, message: 'Autonomous deduction cycle initiated' });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    safeMount('/api/soma', checkReady, somaRoutes(system));
    
    // Self-Modification & Nemesis Dashboard Wiring
    app.get('/api/soma/selfmod/status', (req, res) => {
        const sm = system.selfModificationArbiter || system.selfMod;
        if (!sm) return res.json({ success: false, error: 'SelfModificationArbiter not loaded' });
        res.json({ success: true, ...sm.getStatus() });
    });

    app.get('/api/soma/nemesis/status', (req, res) => {
        const sm = system.selfModificationArbiter || system.selfMod;
        const nemesis = sm?.nemesis;
        if (!nemesis) return res.json({ success: false, error: 'NEMESIS system not loaded' });
        res.json({ 
            success: true, 
            ready: true,
            maxSteps: nemesis.config?.maxSteps || 5,
            tools: nemesis.config?.tools || []
        });
    });
    
    // Setup endpoint to update .env
    app.post('/api/setup/env', async (req, res) => {
        try {
            const updates = req.body;
            const envPath = path.resolve(process.cwd(), '.env');

            // Read existing
            let envContent = '';
            try {
                envContent = await fs.readFile(envPath, 'utf8');
            } catch (e) {
                // If it doesn't exist, we will create it
            }

            // Parse existing
            const envLines = envContent.split('\n');
            const newEnvLines = [];
            const updatedKeys = new Set();

            for (const line of envLines) {
                if (!line.trim() || line.startsWith('#')) {
                    newEnvLines.push(line);
                    continue;
                }
                const [key, ...rest] = line.split('=');
                const cleanKey = key.trim();

                if (updates[cleanKey] !== undefined) {
                    newEnvLines.push(`${cleanKey}=${updates[cleanKey]}`);
                    updatedKeys.add(cleanKey);
                } else {
                    newEnvLines.push(line); // Keep existing
                }
            }

            // Append new keys
            for (const [key, value] of Object.entries(updates)) {
                if (!updatedKeys.has(key)) {
                    newEnvLines.push(`${key}=${value}`);
                }
                // Also update process.env temporarily
                process.env[key] = value;
            }

            await fs.writeFile(envPath, newEnvLines.join('\n'), 'utf8');

            // Proactively notify Kevin if online to reload credentials
            const kevin = system.kevinArbiter || global.SOMA?.kevinArbiter || global.kevinManager;
            if (kevin) {
                if (typeof kevin.reloadCredentials === 'function') {
                    await kevin.reloadCredentials();
                }
                // Also emit a credential updated log event
                if (typeof kevin.emit === 'function') {
                    kevin.emit('log', `[Security] Credentials updated for monitored accounts.`);
                }
            }

            res.json({ success: true, message: "Environment updated & Kevin notified" });
        } catch (e) {
            console.error("Env update failed:", e);
            res.status(500).json({ success: false, error: e.message });
        }
    });

    safeMount('/api/knowledge', checkReady, knowledgeRoutes(system));
    safeMount('/api/research', checkReady, researchRoutes(system));
    safeMount('/api/kevin', kevinRoutes);
    safeMount('/api/pulse', pulseRoutes({
        quadBrain: system.quadBrain,
        goalPlanner: system.goalPlanner,
        contextManager: system.contextManager,
        pulseArbiter: system.pulseArbiter,
        steveArbiter: system.steveArbiter,
        astIndexer: system.astIndexer
    }));

    // 5b. ARBITERIUM
    safeMount('/api/arbiterium', checkReady, arbiteriumRoutes(system));

    // 5c. CAPABILITY REGISTRY
    app.get('/api/capabilities', (req, res) => {
        const reg = system.capabilityRegistry;
        if (!reg) return res.json({ capabilities: [], status: 'not_ready' });
        res.json({ capabilities: reg.getStats(), status: 'ok' });
    });
    app.post('/api/capabilities/:name/enable', (req, res) => {
        const reg = system.capabilityRegistry;
        if (!reg) return res.status(503).json({ error: 'not ready' });
        const ok = reg.enable(req.params.name);
        res.json({ success: ok });
    });
    app.post('/api/capabilities/:name/disable', (req, res) => {
        const reg = system.capabilityRegistry;
        if (!reg) return res.status(503).json({ error: 'not ready' });
        const ok = reg.disable(req.params.name);
        res.json({ success: ok });
    });

    // 6. FINANCE (Full Trading Stack)
    // Read-only market data routes — no auth required (UI uses these freely)
    safeMount('/api/market', checkReady, marketDataRoutes);
    safeMount('/api/performance', checkReady, performanceRoutes);
    safeMount('/api/backtest', checkReady, backtestRoutes);
    safeMount('/api/market-evidence', checkReady, marketEvidenceRoutes);
    safeMount('/api/alerts', checkReady, alertRoutes);
    safeMount('/api/debate', checkReady, debateRoutes);
    safeMount('/api/mission-control', checkReady, missionControlRoutes);
    safeMount('/api/game-theory', checkReady, gameTheoryRoutes);
    safeMount('/api/macro-events', checkReady, macroEventRoutes);
    safeMount('/api/cyber-sec', checkReady, cyberSecRoutes);

    // Execution routes — require enterprise auth key when SOMA_API_KEY is set in env
    // In local dev the default key allows open access; set SOMA_API_KEY in production
    const financeAuth = process.env.SOMA_API_KEY && process.env.SOMA_API_KEY !== 'soma_sk_local_dev_9942a1'
        ? [checkReady, requireEnterpriseAuth]
        : [checkReady];
    safeMount('/api/finance',       ...financeAuth, financeRoutes);
    safeMount('/api/scalping',      ...financeAuth, scalpingRoutes);
    safeMount('/api/lowlatency',    ...financeAuth, lowLatencyRoutes);
    safeMount('/api/alpaca',        ...financeAuth, alpacaRoutes);
    safeMount('/api/learning',      ...financeAuth, performanceRoutes);
    safeMount('/api/trading',       ...financeAuth, performanceRoutes);
    safeMount('/api/exchange',      ...financeAuth, exchangeRoutes);
    safeMount('/api/binance',       ...financeAuth, binanceRoutes);
    safeMount('/api/hyperliquid',   ...financeAuth, hyperliquidRoutes);
    safeMount('/api/guardian',      ...financeAuth, createGuardianRoutes(system.guardian || null));
    safeMount('/api/autonomous',    ...financeAuth, autonomousRoutes);
    safeMount('/api/gridbot',       ...financeAuth, gridBotRoutes);
    safeMount('/api/risk/gateway',   ...financeAuth, riskGatewayRoutes);
    safeMount('/api/notifications', notificationRoutes);  // no checkReady — used during settings modal before system.ready
    safeMount('/api/perception', perceptionRoutes);        // no checkReady — COS daemons may load before system.ready
    safeMount('/api/studio', createStudioRoutes(system));  // user.md-backed operator profile for Studio + Axis
    // Conceive module â€” optional, not always committed to repo
    try {
        const { default: conceiveRoutes } = await import('../../server/routes/conceiveRoutes.js');
        safeMount('/api/conceive', conceiveRoutes);
        console.log('    âœ… Conceive routes mounted');
    } catch (e) {
        console.warn('    âš ï¸  conceiveRoutes.js not found â€” Conceive module disabled (safe to ignore)');
    }

    // â”€â”€ ASI System Routes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    app.get('/api/asi/status', (req, res) => {
        try {
            res.json({
                kernel:        system.asiKernel?.getStatus()       || null,
                benchmark:     system.benchmark?.getStatus()       || null,
                constitutional: system.constitutional?.getStatus() || null,
                transfer:      system.transfer?.getStatus()        || null,
                longHorizon:   system.longHorizon?.getStatus()     || null,
            });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.get('/api/asi/benchmark', (req, res) => {
        try { res.json(system.benchmark?.getDashboardData() || {}); }
        catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.get('/api/asi/transfers', (req, res) => {
        try { res.json(system.transfer?.getTransfers() || []); }
        catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.get('/api/asi/constitutional', (req, res) => {
        try { res.json({ constraints: system.constitutional?.getConstraints() || [], audit: system.constitutional?.audit(20) || [] }); }
        catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.post('/api/asi/cycle', checkReady, async (req, res) => {
        try {
            if (!system.asiKernel) return res.status(503).json({ error: 'ASI Kernel not initialized' });
            const result = await system.asiKernel.runCycle();
            res.json({ ok: true, cycle: result });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.post('/api/asi/vision', checkReady, async (req, res) => {
        try {
            const { description, horizon } = req.body;
            if (!description) return res.status(400).json({ error: 'description required' });
            if (!system.longHorizon) return res.status(503).json({ error: 'LongHorizonPlanner not initialized' });
            const vision = await system.longHorizon.setVision(description, horizon || '30d');
            res.json({ ok: true, vision });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    
    // ── ORACLE API: Neural Predestination ───────────────────────
    app.get('/api/oracle/forecast', (req, res) => {
        // Access MAX through the system bridge
        const oracle = system.max?.oracle || system.oracleKernel;
        if (!oracle) return res.json({ success: false, error: 'Oracle Kernel offline' });
        
        const forecasts = Array.from(oracle.activeVoyages.entries()).map(([goalId, data]) => ({
            goalId,
            path: data.path,
            confidence: data.confidence
        }));
        
        res.json({ success: true, forecasts });
    });
// 7. MISSING COMPONENTS (Dream, Muse, etc.)
    app.get('/api/dream/insights', async (req, res) => {
        try {
            const journalPath = path.join(process.cwd(), 'SOMA', 'dream-journal.json');
            let fileInsights = [];
            let fileNarrative = null;
            let fileLoaded = false;

            try {
                const stat = await fs.stat(journalPath).catch(() => null);
                if (stat) {
                    const content = await fs.readFile(journalPath, 'utf8');
                    const journal = JSON.parse(content);
                    const entries = journal.entries || [];
                    
                    fileInsights = entries.map(entry => ({
                        id: entry.timestamp || Date.now(),
                        type: entry.type === 'episodic_consolidation' ? 'dream' : (entry.type || 'dream'),
                        source: entry.date || 'DreamConsolidation',
                        content: entry.summary,
                        echo: entry.echo || null,
                        confidence: 1.0
                    }));

                    const latestEntry = entries[entries.length - 1];
                    if (latestEntry) {
                        fileNarrative = latestEntry.echo || latestEntry.summary || null;
                    }
                    fileLoaded = true;
                }
            } catch (err) {
                console.error('[Routes] Failed to read dream-journal.json:', err.message);
            }

            if (fileLoaded) {
                return res.json({
                    success: true,
                    recentInsights: fileInsights,
                    narrative: fileNarrative
                });
            }

            const raw = system.dreamArbiter?.getInsights?.() || { recentInsights: [] };
            const insights = raw.recentInsights || [];
            res.json({ success: true, recentInsights: insights, narrative: system.dreamArbiter?.getNarrative?.() || null });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });
    app.get('/api/muse/sparks', (req, res) => {
        const muse = system.museEngine || system.museArbiter || system.muse;
        res.json({ success: true, sparks: muse?.getSparks?.() || [] });
    });

    app.get('/api/muse/status', (req, res) => {
        const muse = system.museEngine || system.museArbiter || system.muse;
        const persona = system.expertiseRegistry?.get?.('creative/muse') || null;
        res.json({
            success: true,
            museEngine: !!muse,
            persona,
            stats: muse?.getStats?.() || null
        });
    });

    app.post('/api/muse/persona', async (req, res) => {
        try {
            const registry = system.expertiseRegistry;
            if (!registry) return res.status(503).json({ success: false, error: 'ExpertiseRegistry offline' });

            const { prompt, query, text, mode, history, domain, constraints } = req.body || {};
            const effectivePrompt = prompt || query || text;
            if (!effectivePrompt) return res.status(400).json({ success: false, error: 'prompt is required' });

            const execution = await registry.run('creative/muse', {
                prompt: effectivePrompt,
                mode: mode || 'full',
                history,
                domain,
                constraints
            }, { level: 'hot' });

            res.json({
                success: true,
                expertise: execution.manifest || null,
                status: execution.status || null,
                ...execution.result
            });
        } catch (error) {
            const status = error.code === 'EXPERTISE_NOT_FOUND' ? 404 : 500;
            res.status(status).json({ success: false, error: error.message });
        }
    });
    app.get('/api/theory-of-mind/insights', (req, res) => {
        const userId = req.query.userId || 'default_user';
        const tom = system.theoryOfMind;
        if (!tom) {
            const recent = system.conversationHistory?.getRecentMessages?.(10) || [];
            const lastUser = [...recent].reverse().find(m => m.role === 'user') || null;
            const intent = lastUser ? lastUser.content?.slice(0, 120) : 'arbiter loading...';
            const tags = lastUser?.content
                ? Array.from(new Set(lastUser.content.toLowerCase().split(/\W+/).filter(w => w.length > 4))).slice(0, 5)
                : [];
            return res.json({ success: true, insights: { intent: { current: intent, confidence: 0.2 }, contextTags: tags } });
        }
        res.json({ success: true, insights: tom.getInsights(userId) });
    });
    app.get('/api/self-evolving/stats', (req, res) => {
        const eng = system.selfEvolvingGoalEngine;
        if (!eng) return res.json({ success: true, active: false, stats: {} });
        const gp = system.goalPlanner;
        const allActive = gp?.getActiveGoals ? (gp.getActiveGoals()?.goals || []) : [];
        const activeGoals = allActive.filter(g => g && ['self_evolution','curiosity_engine','self_inspection','github_discovery'].includes(g.metadata?.source || g.source));
        res.json({ success: true, active: true, stats: eng.stats, activeGoals });
    });
    app.get('/api/velocity/status', (req, res) => {
        try {
            const vt = system.velocityTracker;
            const stats = (vt && typeof vt.getStats === 'function') ? vt.getStats() : { velocity: 0 };
            res.json({ success: true, status: stats });
        } catch (e) {
            res.json({ success: true, status: { velocity: 0, error: e.message } });
        }
    });
    app.get('/api/slc/status', (req, res) => res.json({ success: true, status: system.slcArbiter?.getStatus?.() || { phase: 'idle' } }));
    
    // Personality Traits
    app.get('/api/personality', async (req, res) => {
        try {
            const filePath = path.join(process.cwd(), '.soma', 'personality.json');
            const data = await fs.readFile(filePath, 'utf8').catch(() => null);
            const traits = data ? JSON.parse(data) : (system.quadBrain?.personalityConfig || { analytical: 70, empathetic: 60, creative: 50, assertive: 65 });
            res.json({ success: true, traits });
        } catch (e) { res.json({ success: true, traits: { analytical: 70, empathetic: 60, creative: 50, assertive: 65 } }); }
    });
    app.patch('/api/personality', async (req, res) => {
        try {
            const { traits } = req.body;
            if (!traits) return res.status(400).json({ error: 'traits required' });
            if (system.quadBrain) system.quadBrain.personalityConfig = { ...system.quadBrain.personalityConfig, ...traits };
            const dir = path.join(process.cwd(), '.soma');
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(path.join(dir, 'personality.json'), JSON.stringify(traits, null, 2));
            res.json({ success: true, traits: system.quadBrain?.personalityConfig || traits });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // Audit Logs
    app.get('/api/audit/logs', (req, res) => {
        const limit = parseInt(req.query.limit) || 50;
        const logs = system.auditLogs?.slice(-limit) || [];
        res.json({ success: true, logs });
    });

    // Comprehensive Analytics
    app.get('/api/analytics/learning-metrics', (req, res) => res.json({ success: true, data: system.analytics?.getMetrics?.() || [], metrics: system.analytics?.getMetrics?.() || [] }));
    app.get('/api/analytics/performance', (req, res) => res.json({ success: true, metrics: system.analytics?.getPerformance?.() || [], performance: system.analytics?.getPerformance?.() || { arbiters: 0, healthy: true } }));
    app.get('/api/analytics/memory-usage', (req, res) => res.json({ success: true, data: system.analytics?.getMemoryUsage?.(req.query.range) || [] }));
    app.get('/api/analytics/arbiter-activity', (req, res) => res.json({ success: true, data: system.analytics?.getArbiterActivity?.(req.query.range) || [] }));
    
    // ADMIN TRIGGERS
    app.post('/api/admin/soul-cycle', async (req, res) => {
        try {
            if (system.internalInstinctCore) {
                await system.internalInstinctCore.processCycle();
                res.json({ success: true, message: 'Soul cycle processed' });
            } else {
                res.status(404).json({ error: 'IIC not found' });
            }
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.get('/api/conversation/history', (req, res) => res.json({ success: true, history: system.conversationManager?.getHistory?.(req.query.count || 20) || [] }));
    app.get('/api/soma/vision/last', (req, res) => res.json({ success: true, url: system.argus?.getLastImage?.() || system.visionArbiter?.getLastImage?.() || null }));

    app.get('/api/soma/analytics', (req, res) => {
        const quad = system.quadBrain;
        const mem = system.mnemonicArbiter;
        const arb = system.arbiterRegistry || system.arbiters;
        const totalArbiters = arb ? (arb.size || Object.keys(arb).length || 0) : 0;
        res.json({ success: true, summary: {
            totalQueries:     quad?.totalQueries || 0,
            successRate:      quad?.successRate != null ? Math.round(quad.successRate * 100) : 100,
            activeArbiters:   totalArbiters,
            totalArbiters:    totalArbiters,
            avgResponseTime:  quad?.avgResponseTime || 0,
            tokenUsage:       quad?.totalTokens || 0,
            memoryUsage:      Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
            cacheHitRate:     quad?.cacheHitRate != null ? Math.round(quad.cacheHitRate * 100) : 0,
            uptime:           Math.round(process.uptime()),
        }});
    });

    app.get('/api/skills/stats', (req, res) => {
        const sa = system.skillAcquisition || system.skillTracker;
        if (sa?.getStats) {
            const raw = sa.getStats();
            return res.json({ success: true, stats: { ...raw, tracked: true } });
        }
        // Derive rough skill scores from available system metrics
        const uptime = process.uptime();
        const mem = system.mnemonicArbiter;
        const quad = system.quadBrain;
        const tracked = uptime > 300 && (mem || quad);
        if (!tracked) return res.json({ success: true, stats: { tracked: false } });
        const memCount = mem?.getStats?.()?.totalMemories || 0;
        const queryCount = quad?.totalQueries || 0;
        res.json({ success: true, stats: {
            coding:    Math.min(100, Math.round(queryCount * 0.4)),
            reasoning: Math.min(100, Math.round(queryCount * 0.5)),
            memory:    Math.min(100, Math.round(memCount * 0.3)),
            creativity:Math.min(100, Math.round(queryCount * 0.3)),
            vision:    system.argus ? Math.min(100, 40) : 0,
            strategy:  Math.min(100, Math.round(queryCount * 0.35)),
            tracked: true
        }});
    });

    // Plan viewer â€” reliable REST endpoint (bypasses WS sendMessage race conditions)
    app.get('/api/soma/plan', async (req, res) => {
        try {
            const planPath = path.join(process.cwd(), 'SOMA', 'plan.md');
            const stat = await fs.stat(planPath).catch(() => null);
            if (!stat) return res.json({ success: true, plan: '', updatedAt: null });
            const content = await fs.readFile(planPath, 'utf8');
            res.json({ success: true, plan: content, updatedAt: stat.mtime });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    // 8. SOCIAL (Fixing Social Tab)
    app.get('/api/identity/personas', (req, res) => {
        const arbiter = system.identityArbiter;
        const personas = Array.from(arbiter?.personas?.values() || []);
        res.json({
            success: true,
            personas,
            meta: {
                ready: Boolean(arbiter),
                count: personas.length,
                loadedFrom: arbiter?.repoPath || null,
                lobes: arbiter?.lobeIndex ? Object.fromEntries(Array.from(arbiter.lobeIndex.entries()).map(([lobe, names]) => [lobe, names.size])) : {}
            }
        });
    });
    app.get('/api/identity/active', (req, res) => {
        const active = system.identityArbiter?.getActivePersona?.() || null;
        res.json({ success: true, active });
    });
    app.post('/api/identity/active', (req, res) => {
        try {
            const name = req.body?.name || null;
            const active = system.identityArbiter?.setActivePersona?.(name) || null;
            res.json({ success: true, active });
        } catch (e) {
            res.status(400).json({ success: false, error: e.message });
        }
    });
    app.post('/api/identity/persona/update', async (req, res) => {
        try {
            const { name, updates } = req.body || {};
            if (!name || !updates) return res.status(400).json({ success: false, error: 'name and updates required' });
            const updated = system.identityArbiter?.updatePersona?.(name, updates);
            if (!updated) return res.status(404).json({ success: false, error: 'Persona not found' });

            // Persist to file if we have a path
            if (updated.path) {
                const filePath = path.resolve(updated.path);
                const content = await fs.readFile(filePath, 'utf8');
                const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
                if (fmMatch) {
                    const front = fmMatch[1].split('\n').filter(Boolean);
                    const body = fmMatch[2] || '';
                    const map = new Map(front.map(line => {
                        const [k, ...v] = line.split(':');
                        return [k.trim(), v.join(':').trim()];
                    }));
                    if (updates.preferredBrain !== undefined) {
                        map.set('preferredBrain', updates.preferredBrain);
                    }
                    const nextFront = Array.from(map.entries()).map(([k, v]) => `${k}: ${v}`).join('\n');
                    const nextContent = `---\n${nextFront}\n---\n${body}`;
                    await fs.writeFile(filePath, nextContent, 'utf8');
                }
            }

            res.json({ success: true, persona: updated });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });
    app.post('/api/social/x/post', checkReady, async (req, res) => {
        try {
            const result = await system.xArbiter?.post(req.body.text);
            res.json(result);
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.get('/api/social/autonomy/status', (req, res) => {
        // SocialAutonomyArbiter.getStats() returns the exact shape the frontend expects
        const social = system.socialAutonomy;
        if (social && typeof social.getStats === 'function') {
            return res.json({ success: true, stats: social.getStats() });
        }
        // Fallback: synthesize from available components
        res.json({
            success: true,
            stats: {
                isActive: system.curiosityEngine?.isActive?.() || false,
                lastBrowse: system.curiosityEngine?.lastExploration || 'never',
                friends: 0,
                engagedPosts: 0,
                lastPost: 'never',
                interests: system.curiosityEngine?.curiosityQueue?.length || 0,
                redditActive: !!system.redditSignals,
                sentimentActive: !!system.sentimentAggregator
            }
        });
    });

    app.post('/api/social/autonomy/browse-now', checkReady, async (req, res) => {
        try {
            // Try SocialAutonomyArbiter first (Moltbook browsing)
            if (system.socialAutonomy && typeof system.socialAutonomy.browseFeed === 'function') {
                const result = await system.socialAutonomy.browseFeed();
                return res.json({ success: true, result });
            }
            if (system.curiosityEngine && typeof system.curiosityEngine.explore === 'function') {
                const result = await system.curiosityEngine.explore(req.body.topic || 'trending');
                res.json({ success: true, result });
            } else if (system.webResearcher && typeof system.webResearcher.research === 'function') {
                const result = await system.webResearcher.research(req.body.topic || 'trending');
                res.json({ success: true, result });
            } else {
                res.json({ success: false, error: 'No browsing arbiter available' });
            }
        } catch (e) { res.status(500).json({ success: false, error: e.message }); }
    });

    // 9. FORECASTER (Forecast dossiers + parlay simulation)
    const forecasterLedgerPath = path.join(process.cwd(), 'data', 'forecaster', 'forecast-ledger.json');
    const forecasterSuiteLedgerPath = path.join(process.cwd(), 'data', 'forecaster', 'simulation-suite-ledger.json');
    const simulationExperimentLedgerPath = path.join(process.cwd(), 'data', 'simulation', 'experiment-ledger.json');
    const simulationAutonomyLedgerPath = path.join(process.cwd(), 'data', 'simulation', 'autonomy-ledger.json');
    const codeExperimentLedgerPath = path.join(process.cwd(), 'data', 'code-lab', 'experiment-ledger.json');
    const marketLabLedgerPath = path.join(process.cwd(), 'data', 'market-lab', 'strategy-ledger.json');
    const readArrayLedger = async (ledgerPath) => {
        try {
            const raw = await fs.readFile(ledgerPath, 'utf8');
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    };
    const readForecasterLedger = async () => {
        try {
            const raw = await fs.readFile(forecasterLedgerPath, 'utf8');
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    };
    const writeForecasterLedger = async (entries) => {
        await fs.mkdir(path.dirname(forecasterLedgerPath), { recursive: true });
        await fs.writeFile(forecasterLedgerPath, JSON.stringify(entries.slice(0, 500), null, 2), 'utf8');
    };
    const readForecasterSuiteLedger = async () => {
        try {
            const raw = await fs.readFile(forecasterSuiteLedgerPath, 'utf8');
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    };
    const writeForecasterSuiteLedger = async (entries) => {
        await fs.mkdir(path.dirname(forecasterSuiteLedgerPath), { recursive: true });
        await fs.writeFile(forecasterSuiteLedgerPath, JSON.stringify(entries.slice(0, 100), null, 2), 'utf8');
    };
    const buildForecasterCalibration = (entries) => {
        const graded = entries.filter(entry => entry.grade?.status === 'graded');
        if (!graded.length) {
            return {
                total: entries.length,
                graded: 0,
                hitRate: null,
                avgPredicted: null,
                brierScore: null,
                buckets: []
            };
        }
        const brier = graded.reduce((sum, entry) => {
            const p = Math.max(0, Math.min(1, Number(entry.analysis?.trueProb || entry.trueProb || 0) / 100));
            const y = entry.grade?.hit ? 1 : 0;
            return sum + ((p - y) ** 2);
        }, 0) / graded.length;
        const buckets = [
            { label: '<25%', min: 0, max: 25 },
            { label: '25-50%', min: 25, max: 50 },
            { label: '50-75%', min: 50, max: 75 },
            { label: '75%+', min: 75, max: 101 }
        ].map(bucket => {
            const items = graded.filter(entry => {
                const p = Number(entry.analysis?.trueProb || entry.trueProb || 0);
                return p >= bucket.min && p < bucket.max;
            });
            return {
                label: bucket.label,
                count: items.length,
                hitRate: items.length ? Number(((items.filter(entry => entry.grade?.hit).length / items.length) * 100).toFixed(1)) : null
            };
        });
        return {
            total: entries.length,
            graded: graded.length,
            hitRate: Number(((graded.filter(entry => entry.grade?.hit).length / graded.length) * 100).toFixed(1)),
            avgPredicted: Number((graded.reduce((sum, entry) => sum + Number(entry.analysis?.trueProb || entry.trueProb || 0), 0) / graded.length).toFixed(1)),
            brierScore: Number(brier.toFixed(4)),
            buckets
        };
    };
    const getEntryProbability = (entry = {}) => {
        const candidates = [
            entry.analysis?.trueProb,
            entry.swarm?.consensus?.probability,
            entry.trueProb
        ].map(Number).filter(Number.isFinite);
        return candidates.length ? Math.max(0, Math.min(100, candidates[0])) : null;
    };
    const buildCalibrationLearning = (entries) => {
        const graded = entries.filter(entry => entry.grade?.status === 'graded' && getEntryProbability(entry) != null);
        const groupBy = (keyFn) => {
            const groups = new Map();
            graded.forEach(entry => {
                const key = keyFn(entry) || 'UNKNOWN';
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(entry);
            });
            return Object.fromEntries(Array.from(groups.entries()).map(([key, items]) => {
                const avgPredicted = items.reduce((sum, item) => sum + getEntryProbability(item), 0) / items.length;
                const actual = (items.filter(item => item.grade?.hit).length / items.length) * 100;
                const adjustment = Math.max(-8, Math.min(8, (actual - avgPredicted) * Math.min(1, items.length / 20)));
                return [key, {
                    count: items.length,
                    avgPredicted: Number(avgPredicted.toFixed(1)),
                    actual: Number(actual.toFixed(1)),
                    adjustment: Number(adjustment.toFixed(2))
                }];
            }));
        };
        const global = graded.length ? groupBy(() => 'GLOBAL').GLOBAL : { count: 0, avgPredicted: null, actual: null, adjustment: 0 };
        return {
            global,
            byMode: groupBy(entry => entry.mode),
            bySport: groupBy(entry => entry.legs?.[0]?.sport),
            byMarketType: groupBy(entry => entry.legs?.[0]?.marketType),
            note: graded.length >= 20
                ? 'Calibration learning active from graded forecast outcomes.'
                : 'Calibration learning is conservative until at least 20 graded outcomes exist.'
        };
    };
    const buildBacktestReport = (entries) => {
        const graded = entries
            .filter(entry => entry.grade?.status === 'graded' && getEntryProbability(entry) != null)
            .sort((a, b) => new Date(b.grade?.gradedAt || b.createdAt || 0) - new Date(a.grade?.gradedAt || a.createdAt || 0));
        const scored = graded.map(entry => {
            const predicted = getEntryProbability(entry);
            const hit = Boolean(entry.grade?.hit);
            return {
                id: entry.id,
                createdAt: entry.createdAt,
                mode: entry.mode,
                legs: entry.legs?.length || 0,
                sport: entry.legs?.[0]?.sport || 'UNKNOWN',
                marketType: entry.legs?.[0]?.marketType || 'UNKNOWN',
                predicted,
                hit,
                absoluteError: Number(Math.abs((hit ? 100 : 0) - predicted).toFixed(1)),
                brier: Number((((predicted / 100) - (hit ? 1 : 0)) ** 2).toFixed(4))
            };
        });
        const avg = (items, key) => items.length ? Number((items.reduce((sum, item) => sum + item[key], 0) / items.length).toFixed(3)) : null;
        return {
            count: scored.length,
            recent: scored.slice(0, 20),
            summary: {
                hitRate: scored.length ? Number(((scored.filter(item => item.hit).length / scored.length) * 100).toFixed(1)) : null,
                meanAbsoluteError: avg(scored, 'absoluteError'),
                brierScore: avg(scored, 'brier')
            },
            calibration: buildForecasterCalibration(entries),
            learning: buildCalibrationLearning(entries)
        };
    };
    const groupForecasterPerformance = (entries) => {
        const graded = entries.filter(entry => entry.grade?.status === 'graded');
        const groupBy = (keyFn) => {
            const groups = new Map();
            graded.forEach(entry => {
                const key = keyFn(entry) || 'UNKNOWN';
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(entry);
            });
            return Array.from(groups.entries()).map(([key, items]) => ({
                key,
                count: items.length,
                hitRate: Number(((items.filter(item => item.grade?.hit).length / items.length) * 100).toFixed(1)),
                avgPredicted: Number((items.reduce((sum, item) => sum + Number(item.analysis?.trueProb || 0), 0) / items.length).toFixed(1))
            })).sort((a, b) => b.count - a.count);
        };
        return {
            bySport: groupBy(entry => entry.legs?.[0]?.sport),
            byMarketType: groupBy(entry => entry.legs?.[0]?.marketType),
            byMode: groupBy(entry => entry.mode)
        };
    };
    const buildCovarianceModel = (entries, legs = []) => {
        const graded = entries.filter(entry => entry.grade?.status === 'graded' && Array.isArray(entry.legs));
        const cohortStats = new Map();
        const addCohort = (key, entry) => {
            if (!cohortStats.has(key)) cohortStats.set(key, { count: 0, hits: 0 });
            const row = cohortStats.get(key);
            row.count += 1;
            row.hits += entry.grade?.hit ? 1 : 0;
        };
        graded.forEach(entry => {
            const first = entry.legs?.[0] || {};
            addCohort(`sport:${first.sport || 'UNKNOWN'}`, entry);
            addCohort(`market:${first.marketType || 'UNKNOWN'}`, entry);
            addCohort(`legs:${entry.legs.length}`, entry);
        });
        const pairHints = buildCorrelationMatrix(legs).map(pair => {
            const a = legs[pair.from] || {};
            const b = legs[pair.to] || {};
            let historicalSupport = 'thin';
            const sportKey = `sport:${a.sport || b.sport || 'UNKNOWN'}`;
            const sportStats = cohortStats.get(sportKey);
            if (sportStats?.count >= 10) historicalSupport = `${sportStats.count} graded ${sportKey.replace('sport:', '')} outcomes`;
            return {
                ...pair,
                covarianceType: pair.score > 0.5 ? 'strong_positive' : pair.score > 0.2 ? 'positive' : pair.score < 0 ? 'diversifying' : 'unknown',
                historicalSupport
            };
        });
        return {
            pairs: pairHints,
            cohorts: Object.fromEntries(Array.from(cohortStats.entries()).map(([key, value]) => [key, {
                ...value,
                hitRate: value.count ? Number(((value.hits / value.count) * 100).toFixed(1)) : null
            }])),
            maturity: graded.length >= 50 ? 'learned' : graded.length >= 10 ? 'warming_up' : 'rule_based'
        };
    };
    const buildCorrelationMatrix = (legs = []) => {
        const pairs = [];
        for (let i = 0; i < legs.length; i += 1) {
            for (let j = i + 1; j < legs.length; j += 1) {
                const a = legs[i] || {};
                const b = legs[j] || {};
                let score = 0;
                const reasons = [];
                if (a.entity && a.entity === b.entity) { score += 0.55; reasons.push('same entity'); }
                if (a.gameId && a.gameId === b.gameId) { score += 0.35; reasons.push('same game'); }
                if (a.team && b.team && a.team === b.team) { score += 0.2; reasons.push('same team'); }
                if (a.sport && b.sport && a.sport !== b.sport) { score -= 0.1; reasons.push('different sports'); }
                if (!reasons.length) reasons.push('no known link');
                pairs.push({
                    from: i,
                    to: j,
                    score: Number(Math.max(-1, Math.min(1, score)).toFixed(2)),
                    confidence: reasons[0] === 'no known link' ? 'LOW' : 'MEDIUM',
                    reasons
                });
            }
        }
        return pairs;
    };
    const forecastSwarmAgents = [
        { id: 'sharp_model', name: 'Sharp Model', role: 'Probability Discipline', bias: 0.02, risk: 0.85 },
        { id: 'public_money', name: 'Public Money', role: 'Crowd Bias Detector', bias: -0.015, risk: 0.55 },
        { id: 'oddsmaker', name: 'Oddsmaker', role: 'Market-Implied Anchor', bias: 0, risk: 0.75 },
        { id: 'stat_scout', name: 'Stat Scout', role: 'Recent Form Analyst', bias: 0.025, risk: 0.65 },
        { id: 'contrarian', name: 'Contrarian', role: 'Narrative Fade', bias: -0.025, risk: 0.7 },
        { id: 'risk_manager', name: 'Risk Manager', role: 'Correlation Guard', bias: -0.035, risk: 0.95 },
        { id: 'weather_injury', name: 'Context Scout', role: 'External Friction', bias: -0.01, risk: 0.8 },
        { id: 'ledger_calibrator', name: 'Ledger Calibrator', role: 'Outcome Memory', bias: 0.005, risk: 0.9 }
    ];
    const getCalibrationAdjustmentForLeg = (learning, mode, leg = {}) => {
        const adjustments = [
            learning?.global?.adjustment,
            learning?.byMode?.[mode]?.adjustment,
            learning?.bySport?.[leg.sport]?.adjustment,
            learning?.byMarketType?.[leg.marketType]?.adjustment
        ].map(Number).filter(Number.isFinite);
        if (!adjustments.length) return 0;
        return Math.max(-0.08, Math.min(0.08, adjustments.reduce((sum, value) => sum + value, 0) / adjustments.length / 100));
    };
    const buildDataSourceSummary = (legs = [], lineShop = null, contextSignals = []) => {
        const legSources = legs.flatMap(leg => {
            const sources = [];
            if (leg.sourceStatus) sources.push(leg.sourceStatus);
            if (leg.dataFreshness) sources.push(leg.dataFreshness);
            if (leg.source) sources.push(leg.source);
            return sources;
        });
        return {
            badges: Array.from(new Set([
                ...legSources,
                lineShop?.providerStatus === 'configured' ? 'live-odds-provider' : 'odds-provider-missing',
                contextSignals.length ? 'news-context-scanned' : 'context-not-scanned'
            ])).filter(Boolean),
            liveStatsLegs: legs.filter(leg => leg.sourceStatus === 'real-stats-attached').length,
            heuristicLegs: legs.filter(leg => !leg.sourceStatus || leg.sourceStatus === 'needs-live-stats').length,
            contextSignals: contextSignals.length
        };
    };
    const buildForecastSwarm = ({ legs = [], mode = 'balanced', rounds = 120, calibration = null, learning = null, covariance = null }) => {
        const safeRounds = Math.max(25, Math.min(Number(rounds) || 120, 500));
        const correlationPairs = (covariance?.pairs || buildCorrelationMatrix(legs)).filter(pair => pair.score > 0.2);
        const correlationPenalty = Math.min(0.18, correlationPairs.reduce((sum, pair) => sum + Math.max(0, pair.score), 0) * 0.035);
        const modeBias = { conservative: -0.025, balanced: 0, aggressive: 0.018, research: 0 }[mode] || 0;
        const legModels = legs.map((leg, index) => {
            const odds = Math.max(Number(leg.odds) || 1.91, 1.01);
            const implied = 1 / odds;
            const model = Math.max(0.03, Math.min(0.94, Number(leg.modelProb || leg.confidenceScore || implied)));
            const quality = Math.max(1, Math.min(100, Number(leg.quality) || 55));
            const sampleSize = Math.max(0, Number(leg.sampleSize) || 0);
            const volatility = String(leg.volatility || 'MEDIUM').toUpperCase();
            const uncertainty = (volatility === 'HIGH' ? 0.08 : volatility === 'LOW' ? 0.025 : 0.05) + Math.max(0, 8 - sampleSize) * 0.006;
            return { ...leg, index, implied, model, quality, sampleSize, uncertainty };
        });
        const graded = Number(calibration?.graded || 0);
        const brierPenalty = Number.isFinite(Number(calibration?.brierScore)) ? Math.min(0.06, Number(calibration.brierScore) * 0.08) : 0.025;
        const agents = forecastSwarmAgents.map((agent, agentIndex) => {
            const legOpinions = legModels.map((leg, legIndex) => {
                const qualityBoost = (leg.quality - 60) / 900;
                const sampleBoost = Math.min(0.035, leg.sampleSize * 0.003);
                const marketGap = (leg.model - leg.implied) * (agent.id === 'oddsmaker' ? 0.2 : 0.55);
                const riskPenalty = agent.risk * (leg.uncertainty + correlationPenalty / Math.max(legs.length, 1));
                const learnedAdjustment = agent.id === 'ledger_calibrator' ? getCalibrationAdjustmentForLeg(learning, mode, leg) : getCalibrationAdjustmentForLeg(learning, mode, leg) * 0.35;
                const archetypeNoise = Math.sin((agentIndex + 1) * (legIndex + 2) * 1.37) * 0.018;
                const probability = Math.max(0.03, Math.min(0.94, leg.model + agent.bias + modeBias + qualityBoost + sampleBoost + marketGap + learnedAdjustment - riskPenalty - brierPenalty + archetypeNoise));
                return {
                    index: legIndex,
                    entity: leg.entity || `Leg ${legIndex + 1}`,
                    stat: leg.stat || 'Forecast',
                    probability: Number(probability.toFixed(3)),
                    concern: leg.quality < 55 ? 'low quality' : leg.uncertainty > 0.08 ? 'thin data' : marketGap < -0.03 ? 'market disagrees' : 'acceptable',
                    learnedAdjustment: Number((learnedAdjustment * 100).toFixed(2))
                };
            });
            const parlayProbability = legOpinions.reduce((acc, opinion) => acc * opinion.probability, 1) * (1 - correlationPenalty);
            const confidence = Math.max(0.35, Math.min(0.92, 0.74 - (correlationPenalty * 1.1) - (brierPenalty * 2) + (graded ? Math.min(0.08, graded / 250) : 0)));
            const weakest = [...legOpinions].sort((a, b) => a.probability - b.probability)[0];
            return {
                ...agent,
                probability: Number((parlayProbability * 100).toFixed(1)),
                confidence: Number(confidence.toFixed(2)),
                stance: parlayProbability >= 0.22 ? 'support' : parlayProbability >= 0.12 ? 'watch' : 'fade',
                thesis: `${agent.name} ${parlayProbability >= 0.22 ? 'supports the structure' : parlayProbability >= 0.12 ? 'wants more evidence' : 'would fade this build'}; weakest pressure point is ${weakest?.entity || 'unknown'}.`,
                warnings: [
                    ...(correlationPenalty > 0.06 ? ['correlation drag'] : []),
                    ...(brierPenalty > 0.03 ? ['ledger calibration still thin'] : []),
                    ...(legOpinions.some(opinion => opinion.concern !== 'acceptable') ? ['one or more legs need evidence review'] : [])
                ],
                legOpinions
            };
        });
        const probs = agents.map(agent => agent.probability);
        const avg = probs.reduce((sum, value) => sum + value, 0) / Math.max(probs.length, 1);
        const variance = probs.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / Math.max(probs.length, 1);
        const disagreement = Math.sqrt(variance);
        const roundsOut = [];
        for (let round = 1; round <= safeRounds; round += Math.max(1, Math.floor(safeRounds / 12))) {
            const stabilization = 1 - Math.exp(-round / Math.max(20, safeRounds / 4));
            const drift = Math.sin(round * 0.41 + legs.length) * disagreement * 0.18;
            roundsOut.push({
                round,
                consensus: Number((avg * stabilization + (avg + drift) * (1 - stabilization)).toFixed(1)),
                disagreement: Number((disagreement * (1.12 - stabilization * 0.28)).toFixed(1))
            });
        }
        const weakestAgent = [...agents].sort((a, b) => a.probability - b.probability)[0];
        const strongestAgent = [...agents].sort((a, b) => b.probability - a.probability)[0];
        return {
            agents,
            rounds: roundsOut,
            consensus: {
                probability: Number(avg.toFixed(1)),
                low: Number(Math.max(0, avg - disagreement).toFixed(1)),
                high: Number(Math.min(100, avg + disagreement).toFixed(1)),
                disagreement: Number(disagreement.toFixed(1)),
                rating: avg >= 28 && disagreement < 8 ? 'coherent' : avg >= 15 ? 'uncertain' : 'fragile',
                strongestCase: strongestAgent?.thesis || 'No strong case found.',
                weakestAssumption: weakestAgent?.thesis || 'No weak assumption found.',
                recommendation: avg >= 28 && disagreement < 8 ? 'Track as a serious candidate' : avg >= 15 ? 'Keep in simulation and improve evidence' : 'Do not trust without better data'
            },
            evidence: {
                legs: legs.length,
                rounds: safeRounds,
                correlationPairs,
                correlationPenalty: Number((correlationPenalty * 100).toFixed(1)),
                calibrationUsed: Boolean(calibration),
                covarianceMaturity: covariance?.maturity || 'rule_based',
                learning: learning?.note || 'No calibration learning available yet.',
                sources: buildDataSourceSummary(legs),
                note: 'SOMA-native swarm simulation. No external AGPL source code copied.'
            }
        };
    };
    const forecasterOddsCachePath = path.join(process.cwd(), 'data', 'forecaster', 'odds-cache.json');
    const oddsProviderKey = () => process.env.ODDS_API_KEY || process.env.THE_ODDS_API_KEY || '';
    const oddsSportKey = (sport = '') => {
        const key = String(sport || '').toUpperCase();
        if (key === 'NBA') return 'basketball_nba';
        if (key === 'NFL') return 'americanfootball_nfl';
        if (key === 'NHL') return 'icehockey_nhl';
        if (key === 'MLB') return 'baseball_mlb';
        if (key === 'EPL') return 'soccer_epl';
        return 'upcoming';
    };
    const readOddsCache = async () => {
        try {
            const raw = await fs.readFile(forecasterOddsCachePath, 'utf8');
            return JSON.parse(raw);
        } catch {
            return {};
        }
    };
    const writeOddsCache = async (cache) => {
        await fs.mkdir(path.dirname(forecasterOddsCachePath), { recursive: true });
        await fs.writeFile(forecasterOddsCachePath, JSON.stringify(cache, null, 2), 'utf8');
    };
    const fetchOddsSnapshot = async (sportKey, markets = 'h2h,spreads,totals') => {
        const apiKey = oddsProviderKey();
        if (!apiKey) return { status: 'provider_not_configured', data: [], cached: false };
        const cache = await readOddsCache();
        const cacheKey = `${sportKey}:${markets}:us`;
        const cached = cache[cacheKey];
        if (cached && Date.now() - cached.fetchedAt < 5 * 60 * 1000) {
            return { status: 'cached', data: cached.data || [], cached: true, fetchedAt: cached.fetchedAt };
        }
        const url = new URL(`https://api.the-odds-api.com/v4/sports/${sportKey}/odds`);
        url.searchParams.set('apiKey', apiKey);
        url.searchParams.set('regions', 'us');
        url.searchParams.set('markets', markets);
        url.searchParams.set('oddsFormat', 'decimal');
        url.searchParams.set('dateFormat', 'iso');
        const data = await fetchJsonWithTimeout(url.toString(), 9000);
        cache[cacheKey] = { fetchedAt: Date.now(), data };
        await writeOddsCache(cache);
        return { status: 'live', data, cached: false, fetchedAt: cache[cacheKey].fetchedAt };
    };
    const normalizeName = (value = '') => String(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const namesMatch = (a = '', b = '') => {
        const aa = normalizeName(a);
        const bb = normalizeName(b);
        return Boolean(aa && bb && (aa.includes(bb) || bb.includes(aa)));
    };
    const findBestLineForLeg = (leg, oddsEvents = []) => {
        const side = String(leg.side || '').toLowerCase();
        const marketType = String(leg.marketType || '').toLowerCase();
        if (marketType === 'player_prop') {
            return {
                bestAvailable: null,
                status: 'market_not_supported',
                note: 'Provider adapter currently supports h2h, spreads, and totals. Player prop line shopping needs a props market feed.'
            };
        }
        const wantedMarket = side === 'moneyline' || marketType === 'moneyline' ? 'h2h'
            : side === 'spread' || marketType === 'spread' ? 'spreads'
                : side === 'over' || side === 'under' || marketType === 'total' ? 'totals'
                    : 'h2h';
        let best = null;
        for (const event of oddsEvents) {
            const eventMatches = wantedMarket === 'totals'
                || namesMatch(event.home_team, leg.entity)
                || namesMatch(event.away_team, leg.entity)
                || namesMatch(`${event.home_team} ${event.away_team}`, leg.entity);
            if (!eventMatches) continue;
            for (const book of event.bookmakers || []) {
                const market = (book.markets || []).find(item => item.key === wantedMarket);
                if (!market) continue;
                for (const outcome of market.outcomes || []) {
                    const outcomeMatches = wantedMarket === 'totals'
                        ? namesMatch(outcome.name, side || 'over')
                        : namesMatch(outcome.name, leg.entity);
                    if (!outcomeMatches) continue;
                    const candidate = {
                        bookmaker: book.title || book.key,
                        market: wantedMarket,
                        event: `${event.away_team} @ ${event.home_team}`,
                        line: outcome.point ?? null,
                        odds: outcome.price,
                        lastUpdate: book.last_update || event.commence_time
                    };
                    if (!best || Number(candidate.odds) > Number(best.odds)) best = candidate;
                }
            }
        }
        return best
            ? { bestAvailable: best, status: 'matched', note: 'Best decimal odds found across available US books.' }
            : { bestAvailable: null, status: 'no_match', note: 'Provider returned odds, but no confident match for this leg.' };
    };

    app.get('/api/forecaster/provider-status', checkReady, async (req, res) => {
        res.json({
            success: true,
            oddsProvider: oddsProviderKey() ? 'configured' : 'missing',
            supportedMarkets: ['h2h', 'spreads', 'totals'],
            cacheTtlSeconds: 300
        });
    });

    app.get('/api/forecaster/guesses', checkReady, async (req, res) => {
        try {
            const fs = await import('fs/promises');
            const path = await import('path');
            const guessesPath = path.join(process.cwd(), 'appendages', 'forecaster', 'active_guesses.json');
            let guesses = [];
            try {
                guesses = JSON.parse(await fs.readFile(guessesPath, 'utf8'));
            } catch (err) {
                // Return empty if not found
            }
            res.json({ success: true, guesses });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.get('/api/forecaster/simulation-feed', checkReady, async (req, res) => {
        try {
            const limit = Math.max(5, Math.min(100, parseInt(req.query.limit, 10) || 40));
            const sortRecent = (a, b) => new Date(b.updatedAt || b.createdAt || b.timestamp || 0) - new Date(a.updatedAt || a.createdAt || a.timestamp || 0);
            const timestampOf = (entry) => entry.updatedAt || entry.createdAt || entry.completedAt || entry.timestamp || null;
            const confidencePct = (value) => {
                const n = Number(value);
                if (!Number.isFinite(n)) return null;
                return Math.round(n <= 1 ? n * 100 : n);
            };

            const rawSimulationEntries = await readArrayLedger(simulationExperimentLedgerPath);

            const simulationEntries = rawSimulationEntries
                .sort(sortRecent)
                .slice(0, limit)
                .map(entry => ({
                    id: entry.id || `simulation-${timestampOf(entry) || Math.random()}`,
                    source: entry.domain || 'simulation-suite',
                    kind: entry.kind || entry.type || 'experiment',
                    title: entry.title || entry.name || entry.objective || 'Simulation experiment',
                    target: entry.target || entry.subject || entry.domain || null,
                    status: entry.status || 'observed',
                    confidence: confidencePct(entry.confidence ?? entry.score),
                    actionable: ['promoted', 'ready_for_promotion', 'validated'].includes(entry.status),
                    timestamp: timestampOf(entry),
                    sourceLedger: 'data/simulation/experiment-ledger.json',
                    metrics: entry.metrics || entry.results?.metrics || null,
                    evidence: [
                        entry.summary,
                        entry.result,
                        entry.lesson,
                        entry.failureReason,
                        entry.promotionReason
                    ].filter(Boolean)
                }));

            const sportsSimulationEntries = simulationEntries.filter(entry =>
                /forecast|sports|parlay|nba|nfl|nhl|mlb|epl|wnba|ncaab/i.test(`${entry.title} ${entry.kind} ${entry.target}`)
            );

            const feed = sportsSimulationEntries
                .sort(sortRecent);

            res.json({
                success: true,
                generatedAt: new Date().toISOString(),
                policy: {
                    mode: 'evidence_only',
                    notice: 'Forecaster simulation feed is sports-context only. It is not a live pick, wager, market trade, or execution signal.'
                },
                counts: {
                    total: feed.length,
                    market: 0,
                    simulations: sportsSimulationEntries.length,
                    code: 0,
                    autonomy: 0,
                    actionable: feed.filter(item => item.actionable).length,
                    availableBySource: {
                        market: 0,
                        simulations: rawSimulationEntries.length,
                        autonomy: 0,
                        code: 0
                    }
                },
                feed
            });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.get('/api/forecaster/ledger', checkReady, async (req, res) => {
        try {
            const entries = await readForecasterLedger();
            res.json({ success: true, entries: entries.slice(0, 100), calibration: buildForecasterCalibration(entries) });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.get('/api/forecaster/performance', checkReady, async (req, res) => {
        try {
            const entries = await readForecasterLedger();
            res.json({
                success: true,
                calibration: buildForecasterCalibration(entries),
                backtest: buildBacktestReport(entries),
                learning: buildCalibrationLearning(entries),
                performance: groupForecasterPerformance(entries),
                dataQuality: {
                    ledgerEntries: entries.length,
                    gradedEntries: entries.filter(entry => entry.grade?.status === 'graded').length,
                    note: 'Performance only reflects graded ledger entries. Ungraded forecasts are excluded.'
                }
            });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.get('/api/forecaster/backtest', checkReady, async (req, res) => {
        try {
            const entries = await readForecasterLedger();
            res.json({ success: true, ...buildBacktestReport(entries) });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.post('/api/forecaster/ledger', checkReady, async (req, res) => {
        try {
            const entry = req.body || {};
            const entries = await readForecasterLedger();
            const saved = {
                id: entry.id || `forecast-${Date.now()}`,
                createdAt: entry.createdAt || new Date().toISOString(),
                type: entry.type || 'parlay_scenario',
                mode: entry.mode || 'balanced',
                legs: Array.isArray(entry.legs) ? entry.legs : [],
                analysis: entry.analysis || null,
                swarm: entry.swarm || null,
                grade: entry.grade || { status: 'pending' },
                source: 'Forecast OS'
            };
            const next = [saved, ...entries.filter(item => item.id !== saved.id)];
            await writeForecasterLedger(next);
            res.json({ success: true, entry: saved, calibration: buildForecasterCalibration(next) });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.post('/api/forecaster/ledger/:id/grade', checkReady, async (req, res) => {
        try {
            const entries = await readForecasterLedger();
            const idx = entries.findIndex(entry => entry.id === req.params.id);
            if (idx === -1) return res.status(404).json({ success: false, error: 'Forecast entry not found' });
            entries[idx] = {
                ...entries[idx],
                grade: {
                    status: 'graded',
                    hit: Boolean(req.body?.hit),
                    result: req.body?.result || (req.body?.hit ? 'hit' : 'miss'),
                    notes: req.body?.notes || '',
                    gradedAt: new Date().toISOString()
                }
            };
            await writeForecasterLedger(entries);
            res.json({ success: true, entry: entries[idx], calibration: buildForecasterCalibration(entries) });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.post('/api/forecaster/ledger/:id/auto-grade', checkReady, async (req, res) => {
        try {
            const entries = await readForecasterLedger();
            const idx = entries.findIndex(entry => entry.id === req.params.id);
            if (idx === -1) return res.status(404).json({ success: false, error: 'Forecast entry not found' });
            const entry = entries[idx];
            const legs = Array.isArray(entry.legs) ? entry.legs : [];
            const gradable = legs.filter(leg => Number.isFinite(Number(leg.resultValue)) && Number.isFinite(Number(leg.line)));
            if (!gradable.length) {
                entries[idx] = {
                    ...entry,
                    grade: {
                        status: 'needs_manual_result',
                        hit: null,
                        result: 'needs_manual_result',
                        notes: 'No exact resultValue fields are attached to saved legs yet.',
                        gradedAt: new Date().toISOString()
                    }
                };
                await writeForecasterLedger(entries);
                return res.json({ success: true, entry: entries[idx], calibration: buildForecasterCalibration(entries) });
            }
            const legResults = gradable.map(leg => {
                const side = String(leg.side || 'over').toLowerCase();
                const resultValue = Number(leg.resultValue);
                const line = Number(leg.line);
                const hit = side === 'under' ? resultValue < line : side === 'moneyline' ? Boolean(leg.resultHit) : resultValue > line;
                return { entity: leg.entity, stat: leg.stat, side, line, resultValue, hit };
            });
            const scenarioHit = legResults.every(result => result.hit);
            entries[idx] = {
                ...entry,
                grade: {
                    status: 'graded',
                    hit: scenarioHit,
                    result: scenarioHit ? 'hit' : 'miss',
                    legResults,
                    notes: 'Auto-graded from explicit saved resultValue fields.',
                    gradedAt: new Date().toISOString()
                }
            };
            await writeForecasterLedger(entries);
            res.json({ success: true, entry: entries[idx], calibration: buildForecasterCalibration(entries) });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.post('/api/forecaster/correlation-matrix', checkReady, async (req, res) => {
        try {
            const legs = Array.isArray(req.body?.legs) ? req.body.legs : [];
            const entries = await readForecasterLedger();
            const covariance = buildCovarianceModel(entries, legs);
            res.json({ success: true, matrix: covariance.pairs, covariance });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.post('/api/forecaster/line-shop', checkReady, async (req, res) => {
        try {
            const legs = Array.isArray(req.body?.legs) ? req.body.legs : [];
            if (!oddsProviderKey()) {
                return res.json({
                    success: true,
                    provider: 'the-odds-api',
                    providerStatus: 'missing_key',
                    lines: legs.map((leg, index) => ({
                        index,
                        entity: leg.entity,
                        stat: leg.stat,
                        currentLine: leg.line,
                        currentOdds: leg.odds,
                        bestAvailable: null,
                        status: 'provider_not_configured',
                        note: 'Set ODDS_API_KEY or THE_ODDS_API_KEY to enable live line shopping.'
                    }))
                });
            }
            const sports = Array.from(new Set(legs.map(leg => oddsSportKey(leg.sport)).filter(Boolean)));
            const snapshots = {};
            for (const sportKey of sports.length ? sports : ['upcoming']) {
                snapshots[sportKey] = await fetchOddsSnapshot(sportKey);
            }
            res.json({
                success: true,
                provider: 'the-odds-api',
                providerStatus: 'configured',
                lines: legs.map((leg, index) => {
                    const sportKey = oddsSportKey(leg.sport);
                    const snapshot = snapshots[sportKey] || snapshots.upcoming || { data: [] };
                    const match = findBestLineForLeg(leg, snapshot.data || []);
                    return {
                        index,
                        entity: leg.entity,
                        stat: leg.stat,
                        currentLine: leg.line,
                        currentOdds: leg.odds,
                        sportKey,
                        snapshotStatus: snapshot.status,
                        fetchedAt: snapshot.fetchedAt || null,
                        ...match
                    };
                })
            });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    const fetchJsonWithTimeout = async (url, timeoutMs = 7000) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, {
                signal: controller.signal,
                headers: { 'User-Agent': 'SOMA-ForecastOS/1.0' }
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } finally {
            clearTimeout(timeout);
        }
    };
    const inferForecasterStatKey = (stat = '') => {
        const text = String(stat).toLowerCase();
        if (/\bpassing/.test(text)) return { key: 'passingYards', label: 'passing yards' };
        if (/\brushing/.test(text)) return { key: 'rushingYards', label: 'rushing yards' };
        if (/\breceiving/.test(text)) return { key: 'receivingYards', label: 'receiving yards' };
        if (/\btouchdown/.test(text)) return { key: 'touchdowns', label: 'touchdowns' };
        if (/\bshot/.test(text)) return { key: 'shots', label: 'shots' };
        if (/\bgoal/.test(text)) return { key: 'goals', label: 'goals' };
        if (/\bassist/.test(text)) return { key: 'ast', label: 'assists' };
        if (/\brebound/.test(text)) return { key: 'reb', label: 'rebounds' };
        if (/\bpoint/.test(text)) return { key: 'pts', label: 'points' };
        return { key: 'pts', label: 'points' };
    };
    const summarizeValues = (values = []) => {
        const clean = values.map(Number).filter(Number.isFinite);
        if (!clean.length) return null;
        const mean = clean.reduce((sum, value) => sum + value, 0) / clean.length;
        const variance = clean.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / clean.length;
        const stdDev = Math.sqrt(variance);
        return {
            sampleSize: clean.length,
            average: Number(mean.toFixed(1)),
            stdDev: Number(stdDev.toFixed(1)),
            volatility: stdDev / Math.max(mean, 1) > 0.45 ? 'HIGH' : stdDev / Math.max(mean, 1) > 0.25 ? 'MEDIUM' : 'LOW'
        };
    };
    const probabilityFromLine = ({ average, stdDev, line, side = 'over', fallback = 0.55 }) => {
        const avg = Number(average);
        const sd = Math.max(Number(stdDev) || Math.max(Math.abs(avg) * 0.25, 1), 1);
        const targetLine = Number(line);
        if (!Number.isFinite(avg) || !Number.isFinite(targetLine)) return fallback;
        const directionalMargin = String(side).toLowerCase() === 'under'
            ? targetLine - avg
            : avg - targetLine;
        const z = Math.max(-2.2, Math.min(2.2, directionalMargin / sd));
        // Smooth logistic approximation of a normal CDF. Good enough for v1
        // while avoiding a heavy stats dependency in the main Node server.
        return Math.max(0.08, Math.min(0.9, 1 / (1 + Math.exp(-1.45 * z))));
    };
    const enrichNbaLeg = async (leg) => {
        const playerName = String(leg.entity || '').replace(/\b(vs|against)\b.*$/i, '').trim();
        if (!playerName) return null;
        const stat = inferForecasterStatKey(leg.stat);
        const seasonYear = new Date().getMonth() >= 9 ? new Date().getFullYear() : new Date().getFullYear() - 1;
        const search = await fetchJsonWithTimeout(`https://www.balldontlie.io/api/v1/players?search=${encodeURIComponent(playerName)}`);
        const player = search?.data?.[0];
        if (!player?.id) return null;
        const stats = await fetchJsonWithTimeout(`https://www.balldontlie.io/api/v1/stats?seasons[]=${seasonYear}&player_ids[]=${player.id}&per_page=15`);
        const recentGames = (stats?.data || []).map(game => ({
            date: game.game?.date,
            opponent: game.game?.home_team_id === game.team?.id ? game.game?.visitor_team_id : game.game?.home_team_id,
            pts: game.pts,
            ast: game.ast,
            reb: game.reb,
            min: game.min
        }));
        const summary = summarizeValues(recentGames.map(game => game[stat.key]));
        if (!summary) return null;
        return {
            provider: 'balldontlie',
            sport: 'NBA',
            marketType: 'player_prop',
            player: `${player.first_name} ${player.last_name}`,
            team: player.team?.full_name || player.team?.abbreviation || null,
            statLabel: stat.label,
            recentGames,
            ...summary
        };
    };
    const enrichNhlLeg = async (leg) => {
        const playerName = String(leg.entity || '').replace(/\b(vs|against)\b.*$/i, '').trim();
        if (!playerName) return null;
        const stat = inferForecasterStatKey(leg.stat);
        const search = await fetchJsonWithTimeout(`https://suggest.svc.nhl.com/svc/suggest/v1/minplayers/${encodeURIComponent(playerName)}/99999`);
        const suggestion = search?.suggestions?.[0];
        const playerId = String(suggestion || '').split('|')[0];
        if (!playerId) return null;
        const data = await fetchJsonWithTimeout(`https://api-web.nhle.com/v1/player/${playerId}/landing`);
        const recentGames = (data?.last5Games || []).map(game => ({
            date: game.gameDate,
            opponent: game.opponentAbbrev,
            goals: game.goals,
            assists: game.assists,
            points: game.points,
            shots: game.shots,
            toi: game.toi
        }));
        const key = stat.key === 'pts' ? 'points' : stat.key === 'ast' ? 'assists' : stat.key;
        const summary = summarizeValues(recentGames.map(game => game[key]));
        if (!summary) return null;
        return {
            provider: 'nhl-official',
            sport: 'NHL',
            marketType: 'player_prop',
            player: `${data.firstName?.default || ''} ${data.lastName?.default || ''}`.trim() || playerName,
            team: data.currentTeamAbbrev || null,
            statLabel: stat.label,
            recentGames,
            ...summary
        };
    };
    const flattenEspnStats = (node, out = []) => {
        if (!node || typeof node !== 'object') return out;
        if (Array.isArray(node)) {
            node.forEach(item => flattenEspnStats(item, out));
            return out;
        }
        if (node.name || node.displayName || node.shortDisplayName) {
            const rawValue = node.value ?? node.displayValue;
            const numericValue = Number(String(rawValue ?? '').replace(/,/g, '').match(/-?\d+(\.\d+)?/)?.[0]);
            if (Number.isFinite(numericValue)) {
                out.push({
                    name: String(node.name || node.displayName || node.shortDisplayName).toLowerCase(),
                    displayName: String(node.displayName || node.shortDisplayName || node.name || '').toLowerCase(),
                    value: numericValue
                });
            }
        }
        Object.values(node).forEach(value => flattenEspnStats(value, out));
        return out;
    };
    const enrichNflLeg = async (leg) => {
        const playerName = String(leg.entity || '').replace(/\b(vs|against)\b.*$/i, '').trim();
        if (!playerName) return null;
        const stat = inferForecasterStatKey(leg.stat);
        const search = await fetchJsonWithTimeout(`https://site.api.espn.com/apis/common/v3/search?query=${encodeURIComponent(playerName)}&limit=1&league=nfl`);
        const athlete = search?.results?.[0];
        if (!athlete?.id) return null;
        const data = await fetchJsonWithTimeout(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/athletes/${athlete.id}/statistics`);
        const flattened = flattenEspnStats(data);
        const aliases = {
            passingYards: ['passingyards', 'passing yards', 'pass yards', 'yds'],
            rushingYards: ['rushingyards', 'rushing yards', 'rush yards'],
            receivingYards: ['receivingyards', 'receiving yards', 'rec yards'],
            touchdowns: ['touchdowns', 'td', 'tds']
        }[stat.key] || [stat.label];
        const match = flattened.find(item => aliases.some(alias => item.name.includes(alias) || item.displayName.includes(alias)));
        if (!match) return null;
        return {
            provider: 'espn',
            sport: 'NFL',
            marketType: 'player_prop',
            player: athlete.name || playerName,
            team: athlete.team?.name || athlete.team?.abbreviation || null,
            statLabel: stat.label,
            sampleSize: 1,
            average: Number(match.value.toFixed(1)),
            stdDev: Math.max(Number(match.value) * 0.25, 1),
            volatility: 'MEDIUM',
            recentGames: [],
            note: 'ESPN season/stat summary, not game-log distribution yet.'
        };
    };
    const espnSportPath = (sport = '') => {
        const key = String(sport || '').toUpperCase();
        if (key === 'NBA') return 'basketball/nba';
        if (key === 'NFL') return 'football/nfl';
        if (key === 'NHL') return 'hockey/nhl';
        if (key === 'MLB') return 'baseball/mlb';
        return null;
    };
    const fetchForecasterContextSignals = async (leg = {}) => {
        const sportPath = espnSportPath(leg.sport);
        const query = normalizeName(`${leg.entity || ''} ${leg.team || ''}`);
        const signals = [];
        if (!sportPath || !query) {
            return {
                status: 'not_available',
                signals,
                notes: ['Context scan needs a supported sport and entity/team name.']
            };
        }
        try {
            const news = await fetchJsonWithTimeout(`https://site.api.espn.com/apis/site/v2/sports/${sportPath}/news?limit=25`, 7000);
            for (const item of news?.articles || []) {
                const headline = item.headline || item.title || '';
                const description = item.description || '';
                const text = `${headline} ${description}`.toLowerCase();
                if (!query.split(' ').some(token => token.length > 3 && text.includes(token))) continue;
                const tags = [];
                if (/\b(injury|injured|questionable|doubtful|out|illness|hamstring|ankle|knee|concussion)\b/i.test(text)) tags.push('injury');
                if (/\b(rain|wind|snow|weather|storm|delay)\b/i.test(text)) tags.push('weather');
                if (/\b(lineup|starter|minutes|rest|load management|inactive)\b/i.test(text)) tags.push('availability');
                signals.push({
                    type: tags[0] || 'news',
                    headline,
                    source: item.source || 'ESPN',
                    publishedAt: item.published || item.lastModified || null,
                    url: item.links?.web?.href || item.link || null,
                    tags
                });
                if (signals.length >= 5) break;
            }
            return {
                status: signals.length ? 'signals_found' : 'no_relevant_signals',
                signals,
                notes: signals.length
                    ? [`Found ${signals.length} contextual ESPN signal(s).`]
                    : ['No matching injury/weather/news signals found in the current ESPN feed.']
            };
        } catch (e) {
            return {
                status: 'source_error',
                signals,
                notes: [`Context source unavailable: ${e.message}`]
            };
        }
    };

    const enrichForecastLegInternal = async (inputLeg = {}) => {
        const leg = inputLeg || {};
        const text = `${leg.entity || ''} ${leg.stat || ''}`.toLowerCase();
        const sport = leg.sport || (
            /\b(passing|rushing|receiving|touchdown|yards|nfl)\b/.test(text) ? 'NFL'
                : /\b(points|rebounds|assists|nba|basketball)\b/.test(text) ? 'NBA'
                    : /\b(goals|shots|nhl|hockey)\b/.test(text) ? 'NHL'
                        : 'UNKNOWN'
        );
        const marketType = leg.marketType || (
            /\b(moneyline|ml)\b/.test(text) ? 'moneyline'
                : /\b(spread)\b/.test(text) ? 'spread'
                    : /\b(total)\b/.test(text) ? 'total'
                        : 'player_prop'
        );
        const line = Number(leg.line ?? leg.value ?? 0);
        const modelProb = Math.max(0.05, Math.min(0.92, Number(leg.modelProb || leg.confidenceScore || 0.55)));
        const sampleSize = Number(leg.sampleSize || 0);
        let realStats = null;
        if (marketType === 'player_prop') {
            if (sport === 'NBA') realStats = await enrichNbaLeg(leg).catch(() => null);
            else if (sport === 'NHL') realStats = await enrichNhlLeg(leg).catch(() => null);
            else if (sport === 'NFL') realStats = await enrichNflLeg(leg).catch(() => null);
        }
        const enrichedSampleSize = Number(realStats?.sampleSize || sampleSize || 0);
        const average = Number(realStats?.average ?? leg.average ?? leg.value ?? line ?? 0);
        const volatility = realStats?.volatility || leg.volatility || (enrichedSampleSize >= 10 ? 'MEDIUM' : 'HIGH');
        const enrichedProb = realStats
            ? probabilityFromLine({
                average,
                stdDev: realStats.stdDev,
                line,
                side: leg.side || 'over',
                fallback: modelProb
            })
            : modelProb;
        const confidenceScore = Math.max(0.35, Math.min(0.88, enrichedProb + Math.min(enrichedSampleSize, 12) * 0.01 - (volatility === 'HIGH' ? 0.06 : 0)));
        const context = await fetchForecasterContextSignals({
            ...leg,
            sport: realStats?.sport || sport,
            team: realStats?.team || leg.team
        });
        const contextPenalty = context.signals.some(signal => signal.tags?.includes('injury') || signal.tags?.includes('availability')) ? 0.03 : 0;
        const sourceStatus = realStats ? 'real-stats-attached' : (sampleSize > 0 ? 'partial-stats-attached' : 'needs-live-stats');
        const dataFreshness = realStats ? 'recent-game-log' : 'heuristic';

        return {
            ...leg,
            entity: realStats?.player || leg.entity,
            sport: realStats?.sport || sport,
            marketType: realStats?.marketType || marketType,
            line,
            dataFreshness,
            sourceStatus,
            sampleSize: enrichedSampleSize,
            average,
            recentGames: realStats?.recentGames || leg.recentGames || [],
            team: realStats?.team || leg.team || null,
            volatility,
            confidenceScore: Number(Math.max(0.25, confidenceScore - contextPenalty).toFixed(3)),
            modelProb: Number(Math.max(0.05, enrichedProb - contextPenalty).toFixed(3)),
            probabilityDelta: Number((((enrichedProb - contextPenalty) - modelProb) * 100).toFixed(1)),
            contextSignals: context.signals,
            contextStatus: context.status,
            dataSources: buildDataSourceSummary([{ ...leg, sourceStatus, dataFreshness }], null, context.signals).badges,
            enrichmentNotes: realStats
                ? `${realStats.note || `Attached ${realStats.sampleSize} recent ${realStats.sport} game log(s) from ${realStats.provider}; average ${realStats.average} ${realStats.statLabel} vs line ${line}.`} ${context.notes.join(' ')}`
                : sampleSize > 0
                    ? `Using ${sampleSize} attached comparable(s). ${context.notes.join(' ')}`
                    : `No recent game-log adapter attached yet; using line, odds, and parsed market structure. ${context.notes.join(' ')}`
        };
    };

    app.post('/api/forecaster/enrich-leg', checkReady, async (req, res) => {
        try {
            const leg = req.body?.leg || req.body || {};
            const text = `${leg.entity || ''} ${leg.stat || ''}`.toLowerCase();
            const sport = leg.sport || (
                /\b(passing|rushing|receiving|touchdown|yards|nfl)\b/.test(text) ? 'NFL'
                    : /\b(points|rebounds|assists|nba|basketball)\b/.test(text) ? 'NBA'
                        : /\b(goals|shots|nhl|hockey)\b/.test(text) ? 'NHL'
                            : 'UNKNOWN'
            );
            const marketType = leg.marketType || (
                /\b(moneyline|ml)\b/.test(text) ? 'moneyline'
                    : /\b(spread)\b/.test(text) ? 'spread'
                        : /\b(total)\b/.test(text) ? 'total'
                            : 'player_prop'
            );
            const line = Number(leg.line ?? leg.value ?? 0);
            const modelProb = Math.max(0.05, Math.min(0.92, Number(leg.modelProb || leg.confidenceScore || 0.55)));
            const sampleSize = Number(leg.sampleSize || 0);
            let realStats = null;
            if (marketType === 'player_prop') {
                if (sport === 'NBA') realStats = await enrichNbaLeg(leg).catch(() => null);
                else if (sport === 'NHL') realStats = await enrichNhlLeg(leg).catch(() => null);
                else if (sport === 'NFL') realStats = await enrichNflLeg(leg).catch(() => null);
            }
            const enrichedSampleSize = Number(realStats?.sampleSize || sampleSize || 0);
            const average = Number(realStats?.average ?? leg.average ?? leg.value ?? line ?? 0);
            const volatility = realStats?.volatility || leg.volatility || (enrichedSampleSize >= 10 ? 'MEDIUM' : 'HIGH');
            const enrichedProb = realStats
                ? probabilityFromLine({
                    average,
                    stdDev: realStats.stdDev,
                    line,
                    side: leg.side || 'over',
                    fallback: modelProb
                })
                : modelProb;
            const confidenceScore = Math.max(0.35, Math.min(0.88, enrichedProb + Math.min(enrichedSampleSize, 12) * 0.01 - (volatility === 'HIGH' ? 0.06 : 0)));
            const context = await fetchForecasterContextSignals({
                ...leg,
                sport: realStats?.sport || sport,
                team: realStats?.team || leg.team
            });
            const contextPenalty = context.signals.some(signal => signal.tags?.includes('injury') || signal.tags?.includes('availability')) ? 0.03 : 0;

            res.json({
                success: true,
                leg: {
                    ...leg,
                    entity: realStats?.player || leg.entity,
                    sport: realStats?.sport || sport,
                    marketType: realStats?.marketType || marketType,
                    line,
                    dataFreshness: realStats ? 'recent-game-log' : 'heuristic',
                    sourceStatus: realStats ? 'real-stats-attached' : (sampleSize > 0 ? 'partial-stats-attached' : 'needs-live-stats'),
                    sampleSize: enrichedSampleSize,
                    average,
                    recentGames: realStats?.recentGames || leg.recentGames || [],
                    team: realStats?.team || leg.team || null,
                    volatility,
                    confidenceScore: Number(Math.max(0.25, confidenceScore - contextPenalty).toFixed(3)),
                    modelProb: Number(Math.max(0.05, enrichedProb - contextPenalty).toFixed(3)),
                    probabilityDelta: Number((((enrichedProb - contextPenalty) - modelProb) * 100).toFixed(1)),
                    contextSignals: context.signals,
                    contextStatus: context.status,
                    dataSources: buildDataSourceSummary([{ ...leg, sourceStatus: realStats ? 'real-stats-attached' : (sampleSize > 0 ? 'partial-stats-attached' : 'needs-live-stats'), dataFreshness: realStats ? 'recent-game-log' : 'heuristic' }], null, context.signals).badges,
                    enrichmentNotes: realStats
                        ? `${realStats.note || `Attached ${realStats.sampleSize} recent ${realStats.sport} game log(s) from ${realStats.provider}; average ${realStats.average} ${realStats.statLabel} vs line ${line}.`} ${context.notes.join(' ')}`
                        : sampleSize > 0
                            ? `Using ${sampleSize} attached comparable(s). ${context.notes.join(' ')}`
                            : `No recent game-log adapter attached yet; using line, odds, and parsed market structure. ${context.notes.join(' ')}`
                }
            });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    const forecastSuiteSeedLegs = [
        { sport: 'NBA', entity: 'Luka Doncic', stat: 'points', value: 29.5, line: 29.5, side: 'over', odds: 1.91, modelProb: 0.56, confidenceScore: 0.56, quality: 62, marketType: 'player_prop' },
        { sport: 'NBA', entity: 'Nikola Jokic', stat: 'assists', value: 8.5, line: 8.5, side: 'over', odds: 1.87, modelProb: 0.55, confidenceScore: 0.55, quality: 61, marketType: 'player_prop' },
        { sport: 'NBA', entity: 'Jayson Tatum', stat: 'points', value: 26.5, line: 26.5, side: 'under', odds: 1.95, modelProb: 0.53, confidenceScore: 0.53, quality: 58, marketType: 'player_prop' },
        { sport: 'NFL', entity: 'Patrick Mahomes', stat: 'passing yards', value: 264.5, line: 264.5, side: 'over', odds: 1.91, modelProb: 0.54, confidenceScore: 0.54, quality: 60, marketType: 'player_prop' },
        { sport: 'NFL', entity: 'Christian McCaffrey', stat: 'rushing yards', value: 78.5, line: 78.5, side: 'over', odds: 1.88, modelProb: 0.55, confidenceScore: 0.55, quality: 59, marketType: 'player_prop' },
        { sport: 'NFL', entity: 'Travis Kelce', stat: 'receiving yards', value: 58.5, line: 58.5, side: 'under', odds: 1.93, modelProb: 0.52, confidenceScore: 0.52, quality: 56, marketType: 'player_prop' },
        { sport: 'NHL', entity: 'Connor McDavid', stat: 'shots', value: 3.5, line: 3.5, side: 'over', odds: 1.82, modelProb: 0.57, confidenceScore: 0.57, quality: 63, marketType: 'player_prop' },
        { sport: 'NHL', entity: 'Auston Matthews', stat: 'goals', value: 0.5, line: 0.5, side: 'over', odds: 2.15, modelProb: 0.47, confidenceScore: 0.47, quality: 55, marketType: 'player_prop' }
    ];
    const buildForecastSuiteScenario = (index, { sport = 'ALL', maxLegs = 3 } = {}) => {
        const pool = forecastSuiteSeedLegs.filter(leg => sport === 'ALL' || leg.sport === sport);
        const source = pool.length ? pool : forecastSuiteSeedLegs;
        const legCount = Math.max(1, Math.min(maxLegs, 1 + (index % maxLegs)));
        const legs = [];
        for (let i = 0; i < legCount; i += 1) {
            const seed = source[(index + i * 2) % source.length];
            const lineDrift = ((index + i) % 3 - 1) * 0.5;
            legs.push({
                ...seed,
                line: Number((Number(seed.line) + lineDrift).toFixed(1)),
                value: Number((Number(seed.value) + lineDrift).toFixed(1)),
                suiteSeed: true,
                scenarioSeed: index
            });
        }
        return legs;
    };
    const computeForecasterParlayModel = (legs = [], mode = 'balanced') => {
        const modeMultiplier = { conservative: 0.92, balanced: 1, aggressive: 1.06, research: 1 }[mode] || 1;
        const decimalOdds = legs.map((leg) => Math.max(Number(leg.odds) || 1.91, 1.01));
        const impliedLegProbs = decimalOdds.map((odds) => 1 / odds);
        const impliedProbParlay = impliedLegProbs.reduce((acc, prob) => acc * prob, 1);
        const modelLegs = legs.map((leg, index) => {
            const quality = Math.max(1, Math.min(100, Number(leg.quality) || 50));
            const rawModelProb = Number(leg.modelProb);
            const baseProb = Number.isFinite(rawModelProb) ? rawModelProb : impliedLegProbs[index];
            const qualityPenalty = quality < 50 ? (50 - quality) / 500 : 0;
            const probability = Math.max(0.03, Math.min(0.94, (baseProb * modeMultiplier) - qualityPenalty));
            return { index, entity: leg.entity || `Leg ${index + 1}`, stat: leg.stat || 'Forecast', line: leg.line, value: leg.value, quality, probability };
        });
        const covariance = buildCovarianceModel([], legs);
        const correlated = covariance.pairs.filter(pair => pair.score > 0.2);
        const correlationPenalty = Math.min(0.25, correlated.reduce((sum, pair) => sum + Math.max(0.03, Number(pair.score || 0) * 0.07), 0));
        const qualityPenalty = Math.max(0, (65 - (modelLegs.reduce((sum, leg) => sum + leg.quality, 0) / modelLegs.length)) / 500);
        const modelParlayProb = modelLegs.reduce((acc, leg) => acc * leg.probability, 1);
        const trueProb = Math.max(0, modelParlayProb * (1 - correlationPenalty - qualityPenalty));
        return {
            trueProb: Number((trueProb * 100).toFixed(1)),
            impliedProb: Number((impliedProbParlay * 100).toFixed(1)),
            edge: Number(((trueProb - impliedProbParlay) * 100).toFixed(1)),
            rating: trueProb * 100 >= 25 && correlationPenalty < 0.08 ? 'Reasonable' : trueProb * 100 < 10 || legs.length >= 5 ? 'Long Shot' : 'Fragile',
            legQuality: modelLegs,
            weakLink: [...modelLegs].sort((a, b) => (a.quality * a.probability) - (b.quality * b.probability))[0] || null,
            calibration: {
                mode,
                modelParlayProb: Number((modelParlayProb * 100).toFixed(1)),
                correlationPenalty: Number((correlationPenalty * 100).toFixed(1)),
                qualityPenalty: Number((qualityPenalty * 100).toFixed(1))
            }
        };
    };

    app.get('/api/forecaster/suite/status', checkReady, async (req, res) => {
        try {
            const suiteEntries = await readForecasterSuiteLedger();
            const forecastEntries = await readForecasterLedger();
            res.json({
                success: true,
                latest: suiteEntries[0] || null,
                runs: suiteEntries.slice(0, 20),
                summary: {
                    totalRuns: suiteEntries.length,
                    totalScenarios: suiteEntries.reduce((sum, run) => sum + Number(run.summary?.scenarios || 0), 0),
                    savedForecasts: forecastEntries.filter(entry => entry.source === 'Forecast Simulation Suite').length,
                    gradedForecasts: forecastEntries.filter(entry => entry.source === 'Forecast Simulation Suite' && entry.grade?.status === 'graded').length,
                    latestAt: suiteEntries[0]?.createdAt || null
                },
                backtest: buildBacktestReport(forecastEntries)
            });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.post('/api/forecaster/suite/run', checkReady, async (req, res) => {
        try {
            const {
                scenarios = 12,
                sport = 'ALL',
                mode = 'balanced',
                maxLegs = 3,
                enrich = true
            } = req.body || {};
            const count = Math.max(1, Math.min(Number(scenarios) || 12, 25));
            const now = new Date().toISOString();
            const entries = await readForecasterLedger();
            const learning = buildCalibrationLearning(entries);
            const run = {
                id: `forecast-suite-${Date.now()}`,
                createdAt: now,
                mode,
                sport,
                requestedScenarios: count,
                status: 'completed',
                results: [],
                summary: { scenarios: 0, saved: 0, avgProbability: 0, avgSwarmProbability: 0, needsLiveStats: 0 }
            };

            for (let i = 0; i < count; i += 1) {
                const rawLegs = buildForecastSuiteScenario(i, { sport, maxLegs });
                const legs = [];
                for (const leg of rawLegs) {
                    legs.push(enrich ? await enrichForecastLegInternal(leg) : leg);
                }
                const analysis = computeForecasterParlayModel(legs, mode);
                const covariance = buildCovarianceModel(entries, legs);
                const swarm = buildForecastSwarm({
                    legs,
                    mode,
                    rounds: 120,
                    calibration: buildForecasterCalibration(entries),
                    learning,
                    covariance
                });
                const forecastEntry = {
                    id: `forecast-suite-scenario-${Date.now()}-${i}`,
                    createdAt: new Date().toISOString(),
                    type: 'forecast_simulation_suite',
                    mode,
                    legs,
                    analysis,
                    swarm,
                    grade: { status: 'pending' },
                    source: 'Forecast Simulation Suite',
                    suiteRunId: run.id
                };
                entries.unshift(forecastEntry);
                run.results.push({
                    id: forecastEntry.id,
                    legs: legs.length,
                    primary: legs[0]?.entity || 'Scenario',
                    probability: analysis.trueProb,
                    edge: analysis.edge,
                    swarmProbability: swarm.consensus?.probability,
                    rating: analysis.rating,
                    sources: buildDataSourceSummary(legs).badges
                });
            }

            await writeForecasterLedger(entries);
            run.summary = {
                scenarios: run.results.length,
                saved: run.results.length,
                avgProbability: Number((run.results.reduce((sum, item) => sum + Number(item.probability || 0), 0) / Math.max(1, run.results.length)).toFixed(1)),
                avgSwarmProbability: Number((run.results.reduce((sum, item) => sum + Number(item.swarmProbability || 0), 0) / Math.max(1, run.results.length)).toFixed(1)),
                needsLiveStats: run.results.filter(item => item.sources?.includes('needs-live-stats')).length
            };
            const suiteLedger = await readForecasterSuiteLedger();
            await writeForecasterSuiteLedger([run, ...suiteLedger]);
            
            if (system.universalLearningPipeline) {
                system.universalLearningPipeline.logInteraction({
                    source: 'Simulation Suite',
                    action: 'forecast_suite_run',
                    details: {
                        mode,
                        sport,
                        scenarios: run.results.length,
                        avgProbability: run.summary.avgProbability,
                        avgSwarmProbability: run.summary.avgSwarmProbability
                    },
                    outcome: 'success',
                    tags: ['simulation', 'forecast', sport]
                }).catch(() => {});
            }
            
            res.json({ success: true, run, backtest: buildBacktestReport(entries) });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.post('/api/forecaster/parlay-simulate', checkReady, async (req, res) => {
        try {
            const legs = Array.isArray(req.body?.legs) ? req.body.legs : [];
            const mode = String(req.body?.mode || 'balanced');
            const iterations = Math.min(Math.max(Number(req.body?.iterations) || 10000, 1000), 50000);
            if (!legs.length) return res.status(400).json({ success: false, error: 'No legs provided' });

            const modeMultiplier = {
                conservative: 0.92,
                balanced: 1,
                aggressive: 1.06,
                research: 1
            }[mode] || 1;

            const decimalOdds = legs.map((leg) => Math.max(Number(leg.odds) || 1.91, 1.01));
            const impliedLegProbs = decimalOdds.map((odds) => 1 / odds);
            const impliedProbParlay = impliedLegProbs.reduce((acc, prob) => acc * prob, 1);
            const entries = await readForecasterLedger();
            const learning = buildCalibrationLearning(entries);
            const covariance = buildCovarianceModel(entries, legs);
            const modelLegs = legs.map((leg, index) => {
                const quality = Math.max(1, Math.min(100, Number(leg.quality) || 50));
                const rawModelProb = Number(leg.modelProb);
                const baseProb = Number.isFinite(rawModelProb) ? rawModelProb : impliedLegProbs[index];
                const qualityPenalty = quality < 50 ? (50 - quality) / 500 : 0;
                const learnedAdjustment = getCalibrationAdjustmentForLeg(learning, mode, leg);
                const probability = Math.max(0.03, Math.min(0.94, (baseProb * modeMultiplier) + learnedAdjustment - qualityPenalty));
                return {
                    index,
                    entity: leg.entity || `Leg ${index + 1}`,
                    stat: leg.stat || 'Forecast',
                    line: leg.line,
                    value: leg.value,
                    quality,
                    probability,
                    learnedAdjustment: Number((learnedAdjustment * 100).toFixed(2))
                };
            });
            const modelParlayProb = modelLegs.reduce((acc, leg) => acc * leg.probability, 1);

            const correlated = covariance.pairs.filter(pair => pair.score > 0.2).map(pair => ({
                i: pair.from,
                j: pair.to,
                reason: pair.reasons?.join(', ') || pair.covarianceType,
                historicalSupport: pair.historicalSupport
            }));

            // Conservative correlation adjustment. Without a true covariance model,
            // same-entity/same-game legs get penalized instead of over-promised.
            const correlationPenalty = Math.min(0.25, correlated.reduce((sum, pair) => sum + Math.max(0.03, Number(covariance.pairs.find(p => p.from === pair.i && p.to === pair.j)?.score || 0) * 0.07), 0));
            const qualityPenalty = Math.max(0, (65 - (modelLegs.reduce((sum, leg) => sum + leg.quality, 0) / modelLegs.length)) / 500);
            const trueProb = Math.max(0, modelParlayProb * (1 - correlationPenalty - qualityPenalty));
            const edge = (trueProb - impliedProbParlay) * 100;
            const truePct = trueProb * 100;
            const weakLink = [...modelLegs].sort((a, b) => (a.quality * a.probability) - (b.quality * b.probability))[0] || null;

            let rating = 'Fragile';
            if (truePct >= 25 && correlationPenalty < 0.08) rating = 'Reasonable';
            if (truePct >= 40 && legs.length <= 2) rating = 'Strong';
            if (truePct < 10 || legs.length >= 5) rating = 'Long Shot';

            const suggestions = [];
            if (weakLink && weakLink.quality < 55) suggestions.push(`Weak link is ${weakLink.entity}; improve the line or remove it.`);
            if (legs.length >= 4) suggestions.push('Compare this against a smaller 2-3 leg version.');
            if (correlated.length) suggestions.push('Correlation detected; validate same-game/entity logic before trusting the stack.');
            if (edge < -3) suggestions.push('Market-implied probability is richer than SOMA estimate; structure looks expensive.');
            if (!suggestions.length) suggestions.push('Track this scenario and grade the outcome before increasing trust.');

            res.json({
                success: true,
                trueProb: Number(truePct.toFixed(1)),
                impliedProb: Number((impliedProbParlay * 100).toFixed(1)),
                edge: Number(edge.toFixed(1)),
                weakLink,
                legQuality: modelLegs,
                correlation: correlated.length
                    ? `${correlated.length} linked leg(s): ${correlated.map((c) => c.reason).join(', ')}`
                    : 'No obvious same-game/entity correlation detected',
                rating,
                iterations,
                calibration: {
                    mode,
                    avgLegQuality: Number((modelLegs.reduce((sum, leg) => sum + leg.quality, 0) / modelLegs.length).toFixed(1)),
                    modelParlayProb: Number((modelParlayProb * 100).toFixed(1)),
                    correlationPenalty: Number((correlationPenalty * 100).toFixed(1)),
                    qualityPenalty: Number((qualityPenalty * 100).toFixed(1)),
                    covarianceMaturity: covariance.maturity,
                    learning: learning.note
                },
                dataSources: buildDataSourceSummary(legs),
                covariance,
                suggestions,
                warnings: [
                    ...(legs.length >= 4 ? ['Parlay hit rate drops sharply as legs are added.'] : []),
                    ...(correlated.length ? ['Correlation is estimated conservatively until full historical covariance is available.'] : [])
                ]
            });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    app.post('/api/forecaster/swarm-simulate', checkReady, async (req, res) => {
        try {
            const legs = Array.isArray(req.body?.legs) ? req.body.legs : [];
            if (!legs.length) return res.status(400).json({ success: false, error: 'No legs provided' });
            const entries = await readForecasterLedger();
            const result = buildForecastSwarm({
                legs,
                mode: String(req.body?.mode || 'balanced'),
                rounds: req.body?.rounds || 120,
                calibration: buildForecasterCalibration(entries),
                learning: buildCalibrationLearning(entries),
                covariance: buildCovarianceModel(entries, legs)
            });
            res.json({ success: true, ...result });
        } catch (e) {
            res.status(500).json({ success: false, error: e.message });
        }
    });

    const forecasterHandler = async (req, res) => {
        try {
            const { query, matchup, sport, teams, topic } = req.body || {};
            const prompt = query || matchup || topic || `${sport || 'sports'}: ${Array.isArray(teams) ? teams.join(' vs ') : ''}`;
            const forecaster = system.forecaster;
            if (forecaster && typeof forecaster.getForecast === 'function') {
                const forecast = await forecaster.getForecast(prompt);
                res.json({ success: true, forecast });
            } else {
                const brain = system.quadBrain || system.somArbiter;
                if (brain) {
                    const result = await brain.reason(`Sports forecast: ${prompt}. Analyze recent performance, injuries, market-implied probability, and uncertainty. Do not provide betting instructions.`, { temperature: 0.3 });
                    res.json({ success: true, forecast: { prediction: result.text, confidence: result.confidence || 0.6 } });
                } else {
                    res.json({ success: false, error: 'No forecaster available' });
                }
            }
        } catch (e) { res.status(500).json({ success: false, error: e.message }); }
    };

    app.post('/api/forecaster/moneyball', checkReady, forecasterHandler);
    app.post('/api/forecaster/predict', checkReady, forecasterHandler);

    // â”€â”€ Drive tension status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    app.get('/api/drive/status', (req, res) => {
        const drive = system.drive;
        if (!drive) return res.json({ success: false, error: 'DriveArbiter not loaded', tension: null, satisfaction: null });
        res.json({
            success: true,
            tension: drive.tension,
            satisfaction: drive.satisfaction,
            stats: drive.stats || {}
        });
    });

    // â”€â”€ ORB: File context injection (@filename in OrbWidget queries) â”€â”€â”€â”€â”€â”€
    app.post('/api/fs/read', async (req, res) => {
        const { path: filePath } = req.body || {};
        if (!filePath) return res.status(400).json({ success: false, error: 'path is required' });
        if (!isAllowedPath(filePath)) {
            return res.status(403).json({ success: false, error: 'Path outside allowed roots' });
        }
        try {
            const content = await fs.readFile(path.resolve(filePath), 'utf8');
            res.json({ success: true, content, path: filePath });
        } catch (e) {
            res.status(404).json({ success: false, error: e.message });
        }
    });

    // â”€â”€ Shared conversation history â€” used by CT, FloatingChat, Orb â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Note: messages are stored under the backend's internal session UUID (not the
    // frontend's soma_session_id). getRecentMessages() returns the active session.
    app.get('/api/soma/history', async (req, res) => {
        const { limit = 30 } = req.query;
        try {
            const history = system.conversationHistory
                ? system.conversationHistory.getRecentMessages(parseInt(limit))
                : [];
            const messages = (history || []).map(h => ({
                role: h.role === 'assistant' ? 'soma' : 'user',
                text: h.content || h.text || '',
                timestamp: h.timestamp || Date.now()
            }));
            res.json({ success: true, messages });
        } catch (e) {
            res.json({ success: true, messages: [] });
        }
    });

    // â”€â”€ ORB: Conversation history (persist sessions across refreshes) â”€â”€â”€â”€
    app.get('/api/orb/history', async (req, res) => {
        const { limit = 30 } = req.query;
        try {
            const history = system.conversationHistory
                ? system.conversationHistory.getRecentMessages(parseInt(limit))
                : [];
            const messages = (history || []).map(h => ({
                role: h.role === 'assistant' ? 'soma' : 'user',
                text: h.content || h.text || '',
                timestamp: h.timestamp || Date.now()
            }));
            res.json({ success: true, messages });
        } catch (e) {
            res.json({ success: true, messages: [] });
        }
    });

    // Mount the richer project router first; /api/axis also contains legacy
    // project paths that otherwise intercept members/channels/task responses.
    safeMount('/api/axis/projects',   createProjectRoutes(system));
    safeMount('/api/axis',            createAxisRoutes(system));
    safeMount('/api/axis/communities', createCommunityRoutes(system));
    safeMount('/api/social', createSocialRoutes(system));
    safeMount('/api/maintenance', createMaintenanceRoutes(system));
    safeMount('/api/workspace',  createWorkspaceRoutes(system));
    safeMount('/api/thirdplace', createThirdPlaceRoutes(system));
    safeMount('/api/aperture', createApertureRoutes(system));
    safeMount('/api/gmn', createGmnRoutes(system));

    const kevin = system.kevinArbiter || system.kevinManager;
    if (kevin) app.locals.kevinArbiter = kevin;

    console.log('      âœ… All production routes mounted (Full Tab Coverage Active)');
}
