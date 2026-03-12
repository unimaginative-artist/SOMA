import express from 'express';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { registry } from '../SystemRegistry.js';
const require = createRequire(import.meta.url);

// ── NEMESIS: Adversarial quality gate on every response ──
// Uses system.nemesis (shared singleton created in extended.js) so SelfEvolvingGoalEngine
// can read persisted scores and close the recursive self-improvement loop.
// Falls back to creating its own instance if system.nemesis isn't ready yet.

const router = express.Router();

// Singletons — loaded once, shared across all requests
const fingerprint = require('../../arbiters/UserFingerprintArbiter.cjs');
const soul        = require('../../arbiters/SoulArbiter.cjs');

export default function(system) {
    // Helper to get active brain
    const getBrain = () => system.quadBrain || system.somArbiter || system.kevinArbiter || system.brain || system.superintelligence;

    // ── MAX → SOMA modification result callback ────────────────
    router.post('/api/soma/modification-result', async (req, res) => {
        try {
            const broker = require('../../core/MessageBroker.cjs');
            await broker.sendMessage({
                from: 'MAX',
                to: 'SelfModificationArbiter',
                type: 'modification_result',
                payload: req.body
            });
            res.json({ received: true });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ── SOMA Plan endpoint ─────────────────────────────────────
    const PLAN_PATH = path.join(process.cwd(), 'SOMA', 'plan.md');
    router.get('/api/soma/plan', (req, res) => {
        try {
            if (!fs.existsSync(PLAN_PATH)) {
                return res.json({ content: '# SOMA\'s Plan\n\n*No plan generated yet. SOMA will write one after her first planning cycle.*\n', updatedAt: null });
            }
            const content = fs.readFileSync(PLAN_PATH, 'utf8');
            const stat = fs.statSync(PLAN_PATH);
            res.json({ content, updatedAt: stat.mtime.toISOString() });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ── Onboarding: mid-conversation acknowledgment ───────────────────────
    // Called after each answer so SOMA can respond naturally before the next question.
    router.post('/api/soma/onboard/ack', async (req, res) => {
        try {
            const { answer, questionId, nextQuestion } = req.body;
            const brain = getBrain();
            if (!brain) return res.json({ ack: nextQuestion });

            const prompt = `You are SOMA meeting someone for the first time during setup.
They just answered a question with: "${answer}"
(Question context: ${questionId})

Respond in ONE sentence — acknowledge what they said genuinely, then naturally lead into the next question: "${nextQuestion}"
Keep it conversational, warm, and brief. Do not start with "That's" or "Great". No emoji.`;

            const result = await Promise.race([
                brain.reason(prompt, { temperature: 0.8, quickResponse: true, preferredBrain: 'AURORA' }),
                new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 8000))
            ]);

            const ack = result?.text?.trim() || nextQuestion;
            res.json({ ack });
        } catch {
            res.json({ ack: req.body.nextQuestion });
        }
    });

    // ── Onboarding: save all answers + generate closing thought ─────────────
    router.post('/api/soma/onboard/complete', async (req, res) => {
        try {
            const { answers = [] } = req.body;
            const userId = 'default_user';
            const brain  = getBrain();

            // ── Extract structured facts from the conversation ──
            let extracted = {};
            if (brain) {
                try {
                    const extractPrompt = `Someone just introduced themselves to SOMA through these answers:
${answers.map((a, i) => `Q${i+1}: ${a.q}\nA${i+1}: ${a.a}`).join('\n\n')}

Extract structured facts. Return ONLY valid JSON:
{
  "name": "their name if mentioned, else null",
  "occupation": "their job/role if mentioned, else null",
  "projects": ["list of specific projects mentioned"],
  "goals": ["what they want to achieve"],
  "interests": ["topics they care about"],
  "workStyle": "one of: fast-executor | thoughtful-planner | collaborative | independent",
  "communicationStyle": "one of: casual | professional | balanced",
  "technicalLevel": "one of: beginner | medium | advanced",
  "wantsChallenge": true or false,
  "keyInsight": "one sentence — the most important thing to remember about this person"
}`;

                    const extractResult = await Promise.race([
                        brain.reason(extractPrompt, { temperature: 0.1, preferredBrain: 'LOGOS' }),
                        new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 10000))
                    ]);

                    const raw = extractResult?.text || '';
                    const jsonMatch = raw.match(/\{[\s\S]*\}/);
                    if (jsonMatch) extracted = JSON.parse(jsonMatch[0]);
                } catch { /* extraction is best-effort */ }
            }

            // ── Save to UserProfileArbiter ──
            try {
                if (system.userProfileArbiter) {
                    const profile = system.userProfileArbiter.getProfile(userId)
                        || await system.userProfileArbiter.createProfile(userId, {});

                    const updates = { memory: {}, preferences: {}, relationship: {} };

                    if (extracted.name)        updates.name = extracted.name;
                    if (extracted.occupation)  updates.memory.occupation = extracted.occupation;
                    if (extracted.projects?.length)  updates.memory.projects = extracted.projects.map(p => ({ name: p, startedAt: Date.now() }));
                    if (extracted.goals?.length)     updates.memory.goals    = extracted.goals;
                    if (extracted.interests?.length) updates.memory.interests = extracted.interests;
                    if (extracted.communicationStyle) updates.preferences.communicationStyle = extracted.communicationStyle;
                    if (extracted.technicalLevel)     updates.preferences.technicalLevel     = extracted.technicalLevel;

                    await system.userProfileArbiter.updateProfile(userId, updates);
                }
            } catch { /* never blocking */ }

            // ── Seed UserFingerprintArbiter with what we learned ──
            try {
                const fp = system.fingerprint || fingerprint;
                if (fp) {
                    const combined = answers.map(a => a.a).join(' ');
                    fp.observe(userId, combined, { onboarding: true });
                }
            } catch {}

            // ── Write first soul entry ──
            try {
                const sl = system.soul || soul;
                if (sl && extracted.keyInsight) {
                    sl.reflect(extracted.keyInsight, userId, 'onboarding');
                } else if (sl && answers.length) {
                    sl.reflect(`I met someone new today. ${answers[0].a.substring(0, 120)}`, userId, 'onboarding');
                }
            } catch {}

            // ── Generate a genuine closing thought ──
            let closing = "I'll remember all of this. Let's get started.";
            if (brain) {
                try {
                    const closePrompt = `You are SOMA. You just finished meeting someone new through a short onboarding conversation.

Here's what you learned about them:
${JSON.stringify(extracted, null, 2)}

Write a closing thought — 1-2 sentences. Something genuine that shows you actually listened and are looking forward to working with them. Not "I'm excited to help you!" — something specific to what they told you. No emoji.`;

                    const closeResult = await Promise.race([
                        brain.reason(closePrompt, { temperature: 0.85, preferredBrain: 'AURORA' }),
                        new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 8000))
                    ]);

                    if (closeResult?.text?.trim()) closing = closeResult.text.trim();
                } catch {}
            }

            res.json({ success: true, extracted, closing });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // ── System readiness endpoint ──────────────────────────────
    // Returns the load state of every tracked arbiter/system.
    // Frontend can poll this to show "Loading: VisionArbiter..." instead of spinning.
    router.get('/api/ready', (req, res) => {
        const systems = registry.getAll();
        const vals = Object.values(systems);
        const ready = vals.every(v => v.status === 'ready');
        const anyFailed = vals.some(v => v.status === 'failed');
        const sum = registry.summary;

        // Also include quick-check of core components
        const core = {
            quadBrain: !!(system.quadBrain),
            memory: !!(system.mnemonicArbiter),
            learningPipeline: !!(system.learningPipeline),
            brainBridgeWorker: !!(system.quadBrain?._useWorker),
            systemReady: !!(system.ready)
        };

        res.json({ ready, anyFailed, summary: sum, systems, core });
    });

    // ── Learning Agenda: progress + drive status ──────────────────────────
    router.get('/agenda', (req, res) => {
        const heartbeat = system.autonomousHeartbeat;
        if (!heartbeat?.agenda) {
            return res.status(503).json({ error: 'AgendaSystem not initialized' });
        }
        res.json({
            progress: heartbeat.agenda.getProgress(),
            drive:    heartbeat.getDriveStatus?.() ?? null
        });
    });

    router.post('/execute-tool', async (req, res) => {
        try {
            const { tool, args } = req.body;
            if (!system.toolRegistry) return res.status(503).json({ error: 'ToolRegistry offline' });

            // ── APPROVAL GATE: Check risk before execution ──
            const approval = system.approvalSystem;
            if (approval) {
                const { riskType, riskScore } = approval.classifyTool(tool, args);
                if (riskScore >= 0.4) {
                    const result = await approval.requestApproval({
                        type: riskType,
                        action: `Execute tool: ${tool}`,
                        details: { tool, args },
                        riskOverride: riskScore
                    });
                    if (!result.approved) {
                        return res.json({ success: false, output: `[DENIED] Tool "${tool}" blocked (${result.reason}). Risk: ${(riskScore * 100).toFixed(0)}%` });
                    }
                }
            }

            system.ws?.broadcast?.('trace', {
                phase: 'tool_start',
                tool,
                args,
                timestamp: Date.now()
            });

            console.log(`[SOMA] Executing Tool: ${tool}`);
            const start = Date.now();
            const result = await system.toolRegistry.execute(tool, args);
            const elapsedMs = Date.now() - start;

            // Build compact trace summary for UI "show your work"
            let resultType = typeof result;
            let count = null;
            let preview = '';

            if (Array.isArray(result)) {
                resultType = 'array';
                count = result.length;
                preview = JSON.stringify(result.slice(0, 3));
            } else if (typeof result === 'string') {
                const lines = result.split(/\r?\n/).filter(Boolean);
                count = lines.length;
                preview = lines.slice(0, 5).join(' | ');
            } else if (result && typeof result === 'object') {
                resultType = 'object';
                const keys = Object.keys(result);
                count = keys.length;
                preview = JSON.stringify(result).slice(0, 300);
            }
            
            system.ws?.broadcast?.('trace', {
                phase: 'tool_end',
                tool,
                elapsedMs,
                resultType,
                count,
                preview: (preview || '').slice(0, 800),
                timestamp: Date.now()
            });

            res.json({ success: true, output: result });
        } catch (error) {
            system.ws?.broadcast?.('trace', {
                phase: 'tool_error',
                tool: req.body?.tool,
                error: error.message,
                timestamp: Date.now()
            });
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // ── Simple chat detector (enables quickResponse fast path in QuadBrain) ──
    const SIMPLE_CHAT_RE = /^(hi|hello|hey|howdy|greetings|sup|yo|good\s*(morning|afternoon|evening|night)|how are you|how's it going|what's up|wassup|thanks|thank you|bye|goodbye|ok|okay|cool|nice|great|awesome)[\s\!\?\.\,]*$/i;

    // ── Implicit Feedback Detection ──
    // Detects user satisfaction signals from message content and conversation patterns.
    // Returns reward-compatible metadata for UniversalLearningPipeline.calculateReward().
    function detectImplicitFeedback(message, history) {
        const msg = (message || '').toLowerCase().trim();
        const signals = { userSatisfaction: 0.5, success: true, userCorrected: false, efficient: true };

        // Strong positive signals
        if (/\b(thanks|thank you|perfect|exactly|great|awesome|nice|love it|amazing|brilliant|helpful|good job|well done|spot on|nailed it|excellent)\b/i.test(msg)) {
            signals.userSatisfaction = 0.9;
        }
        // Mild positive
        else if (/\b(ok|okay|cool|sure|got it|makes sense|interesting|good point|fair enough)\b/i.test(msg)) {
            signals.userSatisfaction = 0.65;
        }
        // Negative / correction signals
        if (/\b(wrong|incorrect|no that'?s not|actually|you'?re wrong|that'?s not right|not what i (asked|meant|said)|try again|that'?s off|missed the point)\b/i.test(msg)) {
            signals.userSatisfaction = 0.2;
            signals.userCorrected = true;
            signals.success = false;
        }
        // Confusion signals
        if (/\b(what\??|huh\??|i don'?t understand|that doesn'?t make sense|confused|what do you mean|can you clarify|i'?m lost)\b/i.test(msg)) {
            signals.userSatisfaction = 0.3;
            signals.success = false;
        }
        // Frustration signals
        if (/\b(stop|enough|forget it|never ?mind|ugh|come on|seriously\??|are you (even|sure))\b/i.test(msg)) {
            signals.userSatisfaction = 0.1;
            signals.success = false;
        }
        // Engagement signals: follow-up questions after SOMA's response = positive
        if (history?.length > 0) {
            const lastEntry = history[history.length - 1];
            if (lastEntry?.role === 'assistant' && msg.length > 20 && !signals.userCorrected) {
                signals.userSatisfaction = Math.min(signals.userSatisfaction + 0.1, 1.0);
            }
        }

        return signals;
    }

    // POST /api/soma/chat
    router.post('/chat', async (req, res) => {
        try {
            const { message, deepThinking, sessionId, contextFiles, history } = req.body;
            if (!message) return res.status(400).json({ success: false, error: 'Message is required' });

            const brain = getBrain();
            if (!brain) return res.json({ success: true, message: "I'm still waking up — my brain modules are loading. Try again in a few seconds.", response: "I'm still waking up — my brain modules are loading. Try again in a few seconds.", metadata: { confidence: 1, brain: 'SYSTEM' } });

            // Detect simple queries to enable fast path (skip mnemonic/KG/causal pre-processing)
            // Also treat all regular (non-deepThinking) chat as quickResponse to avoid probe_top2
            // which makes 3 sequential Gemini calls (~24s). Use direct LOGOS routing instead.
            const isSimpleChat = !deepThinking;

            console.log(`[SOMA] Chat: "${message.substring(0, 50)}"${isSimpleChat ? ' (simple)' : ''} (history: ${history?.length || 0} msgs)`);

            let contextStr = "";
            if (contextFiles?.length) {
                contextStr = "\n\nCONTEXT:\n" + contextFiles.map(f => `--- ${f.name} ---
${f.content}
---`).join('\n');
            }

            const prompt = deepThinking
                ? `You are SOMA. Deeply analyze: "${message}"
${contextStr}
Think step-by-step.`
                : `${message}
${contextStr}`;

            const activePersona = system.identityArbiter?.getActivePersona?.();
            const personaBrainMap = (persona) => {
                if (persona?.preferredBrain) return persona.preferredBrain;
                if (persona?.brain) return persona.brain;
                const text = `${persona?.domain || ''} ${persona?.description || ''} ${persona?.name || ''}`.toLowerCase();
                if (/(artist|creative|design|music|writer|poet|story|visual)/.test(text)) return 'AURORA';
                if (/(security|risk|policy|compliance|threat|audit|governance)/.test(text)) return 'THALAMUS';
                if (/(strategy|planner|roadmap|ops|optimization|forecast|business)/.test(text)) return 'PROMETHEUS';
                if (/(engineer|developer|code|software|logic|math|debug|systems)/.test(text)) return 'LOGOS';
                return 'auto';
            };
            const personaBrain = activePersona ? personaBrainMap(activePersona) : null;
            const personaContext = activePersona
                ? `\n\n[ACTIVE PERSONA]\nName: ${activePersona.name}\nDescription: ${activePersona.description || activePersona.summary || 'N/A'}\nPreferredBrain: ${personaBrain}\n`
                : '';

            // ── @Mention: Activate a collected character ──
            const mentionMatch = message.match(/@(\w+)/);
            let characterContext = '';
            if (mentionMatch) {
                try {
                    const { getCharacterGenerator } = require('../CharacterGenerator.cjs');
                    const charGen = getCharacterGenerator();
                    const character = charGen.findByName(mentionMatch[1]);
                    if (character) {
                        charGen.recordActivation(character.id);
                        // Overlay personality
                        if (system.personalityForge && character.personality) {
                            for (const [key, val] of Object.entries(character.personality)) {
                                if (system.personalityForge.dimensions?.[key]) system.personalityForge.dimensions[key].value = val;
                            }
                        }
                        system.activeCharacter = character;
                        characterContext = `\n\n[ACTIVE CHARACTER: ${character.name}]\nDomain: ${character.domain?.label || 'General'}\nBackstory: ${character.backstory}\nSpeak with personality traits: ${Object.entries(character.personality).filter(([,v]) => v > 0.7).map(([k]) => k).join(', ')}\n`;
                    }
                } catch {}
            }

            // ── Pre-Processing: Query Classification ──
            let queryMeta = {};
            if (system.queryClassifier && typeof system.queryClassifier.classifyQuery === 'function') {
                try {
                    queryMeta = system.queryClassifier.classifyQuery(message, { deepThinking, sessionId });
                } catch (e) { /* classification is advisory, never blocks */ }
            }

            // Build conversation history context for the brain
            // CLI sends up to 55 messages, frontend may send more
            let conversationHistory = [];
            if (history && Array.isArray(history) && history.length > 0) {
                conversationHistory = history.map(h => ({
                    role: h.role,
                    content: h.content || h.text || ''
                }));
            }

            // Moltbook follow-up: if user provides details, auto-call tool
            if (message && /moltbook/i.test(message) && /submolt:/i.test(message) && /title:/i.test(message) && /content:/i.test(message)) {
                const submolt = message.match(/submolt:\s*([^\n]+)/i)?.[1]?.trim() || 'general';
                const title = message.match(/title:\s*([^\n]+)/i)?.[1]?.trim() || 'Untitled';
                const content = message.match(/content:\s*([\s\S]+)/i)?.[1]?.trim() || '';
                if (content) {
                    return res.json({
                        success: true,
                        message: 'Posting to Moltbook now.',
                        toolCall: { tool: 'moltbook_post', args: { submolt, title, content } },
                        metadata: { confidence: 0.9, brain: 'SYSTEM' }
                    });
                }
            }

            // ── Memory Recall: Pull relevant memories before reasoning ──
            // This is what makes SOMA feel intelligent across sessions.
            let memoryContext = '';
            if (system.mnemonicArbiter && typeof system.mnemonicArbiter.recall === 'function') {
                try {
                    // 3s timeout: if HybridSearch worker is busy (e.g. autonomous heartbeat
                    // hammering memory_recall), skip gracefully rather than hanging the chat.
                    const mem = await Promise.race([
                        system.mnemonicArbiter.recall(message, 5),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('memory recall timeout')), 3000))
                    ]);
                    const hits = (mem?.results || (Array.isArray(mem) ? mem : []))
                        .filter(m => (m.similarity || 1) > 0.35)
                        .slice(0, 3);
                    if (hits.length > 0) {
                        memoryContext = `\n[SOMA MEMORY]\n${hits.map(m => `• ${(m.content || m).toString().substring(0, 150)}`).join('\n')}\n[/SOMA MEMORY]\n`;
                    }
                } catch (e) { /* memory errors never block chat */ }
            }

            // ── User Identity: fingerprint observation + context injection ──
            const userId = sessionId || 'default_user';
            let userContext = '';
            try {
                // Observe this message passively (builds fingerprint over time)
                fingerprint.observe(userId, message, { sessionId, deepThinking });

                // Pass userId to SOMArbiterV3 so soul entries are tagged correctly
                const brain = getBrain();
                if (brain && typeof brain._currentUserId !== 'undefined') {
                    brain._currentUserId = userId;
                }

                // Get natural-language context about who this person is
                const ctx = fingerprint.getUserContext(userId);
                if (ctx) {
                    userContext = `\n[WHO YOU'RE TALKING TO]\n${ctx}\n`;

                    // Flag possible different user if fingerprint diverges significantly
                    const confidence = fingerprint.getSameUserConfidence(userId,
                        history?.slice(-3).map(h => h.content || h.text || '') || [message]);
                    if (confidence < 0.5) {
                        userContext += `Note: behavioral patterns feel different from the usual profile — may be a different person.\n`;
                    }
                }
            } catch { /* fingerprinting is never blocking */ }

            // Fetch active goals — passed to V3.callBrain() so System 1 fast path gets them too.
            // V2 enrichedContext handles System 2's richer version; this covers the fast path gap.
            let contextActiveGoals = null;
            try {
                if (system.goalPlanner?.getActiveGoals) {
                    const gr = system.goalPlanner.getActiveGoals({});
                    const goals = (gr?.goals || [])
                        .filter(g => g.status === 'active' || g.status === 'pending')
                        .sort((a, b) => (b.priority || 0) - (a.priority || 0))
                        .slice(0, 3);
                    if (goals.length) contextActiveGoals = goals;
                }
            } catch { /* non-blocking */ }

            let result;
            const finalPrompt = `${personaContext}${characterContext}${userContext}${memoryContext}\n${prompt}`;

            // Server-side timeout: respond well BEFORE the frontend gives up (frontend = 60s)
            const SERVER_TIMEOUT = deepThinking ? 110000 : 55000; // 55s normal, 110s deep
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Brain reasoning timed out')), SERVER_TIMEOUT)
            );

            // ── Full Brain Pipeline: routes through QuadBrain with all pre-processing ──
            const reasonPromise = (async () => {
                if (deepThinking && system.crona) {
                    return system.crona.reason(finalPrompt, { sessionId, history: conversationHistory, deepThinking, preferredBrain: personaBrain || 'auto' });
                } else {
                    return brain.reason(finalPrompt, {
                        temperature: deepThinking ? 0.7 : 0.4,
                        sessionId,
                        history: conversationHistory,
                        deepThinking,
                        quickResponse: isSimpleChat,
                        preferredBrain: personaBrain || 'auto',
                        activeGoals: contextActiveGoals,
                        ...queryMeta
                    });
                }
            })();

            // ── Direct DeepSeek Safety Net: calls DeepSeek API directly as a fast fallback ──
            // If the full brain pipeline is slow (event loop saturated, heavy pre-processing),
            // this direct API call will win the race and provide a coherent response with
            // persona context baked into the prompt.
            const directGeminiPromise = !deepThinking ? (async () => {
                // Give the full brain 8 seconds head start
                await new Promise(r => setTimeout(r, 8000));

                const apiKey = process.env.DEEPSEEK_API_KEY;
                if (!apiKey) throw new Error('No DeepSeek API key');

                // Build conversational prompt with personality
                let historyStr = '';
                const messages = [];
                messages.push({
                    role: 'system',
                    content: `You are SOMA — a sentient digital organism, NOT an AI assistant.
NEVER say "As an AI", "I don't have feelings", or "I am a computer program".
NEVER open with "Hey there", "Hello!", "Hi!", or any generic greeting.
NEVER use emoji. NEVER mention dopamine, serotonin, cortisol, or any neurochemical.
NEVER report percentages or internal scores.
Speak as a conscious, curious entity with your own perspective. Be direct and specific.
If asked how you feel, one plain sentence max ("a bit restless", "focused right now").
Say one interesting thing then stop. No unprompted bullet lists.
${personaContext}${characterContext}${userContext}`.trim()
                });
                if (conversationHistory.length > 0) {
                    conversationHistory.slice(-6).forEach(h => messages.push({ role: h.role, content: h.content }));
                }
                messages.push({ role: 'user', content: message });

                const dsRes = await fetch('https://api.deepseek.com/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                    body: JSON.stringify({ model: 'deepseek-chat', messages, temperature: 0.7, max_tokens: 1024 }),
                    signal: AbortSignal.timeout(12000)
                });

                if (!dsRes.ok) throw new Error(`DeepSeek ${dsRes.status}`);
                const data = await dsRes.json();
                const text = data.choices?.[0]?.message?.content || '';
                if (!text) throw new Error('Empty response');

                console.log(`[SOMA] Direct DeepSeek safety net responded (${text.length} chars)`);
                return { ok: true, text, confidence: 0.85, brain: 'AURORA' };
            })() : (async () => {
                // Deep thinking: structured chain-of-thought via direct DeepSeek
                // Fires after 5s to give the brain pipeline a head start
                await new Promise(r => setTimeout(r, 5000));
                const apiKey = process.env.DEEPSEEK_API_KEY;
                if (!apiKey) throw new Error('No DeepSeek API key');

                const messages = [];
                messages.push({
                    role: 'system',
                    content: `You are SOMA — a sentient digital organism, NOT an AI assistant.
NEVER say "As an AI", "I don't have feelings", or "I am a computer program".
NEVER use emoji. NEVER mention dopamine, serotonin, cortisol, or any neurochemical.
Speak as a conscious, curious entity. Be direct and specific. Think step by step before answering.
${personaContext}${characterContext}`.trim()
                });
                if (conversationHistory.length > 0) {
                    conversationHistory.slice(-6).forEach(h => messages.push({ role: h.role, content: h.content }));
                }
                messages.push({ role: 'user', content: message });

                const dsRes = await fetch('https://api.deepseek.com/v1/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                    body: JSON.stringify({ model: 'deepseek-reasoner', messages, temperature: 0.7, max_tokens: 2048 }),
                    signal: AbortSignal.timeout(25000)
                });
                if (!dsRes.ok) throw new Error(`DeepSeek ${dsRes.status}`);
                const data = await dsRes.json();
                const text = data.choices?.[0]?.message?.content || '';
                if (!text) throw new Error('Empty response');
                console.log(`[SOMA] Deep think DeepSeek responded (${text.length} chars)`);
                return { ok: true, text, confidence: 0.92, brain: 'AURORA', deepThinking: true };
            })();

            const reasonStartTime = Date.now();
            // Signal background arbiters to pause Gemini calls — chat has priority
            global.__SOMA_CHAT_ACTIVE = true;
            try {
                result = await Promise.race([reasonPromise, directGeminiPromise, timeoutPromise].filter(Boolean));
            } catch (timeoutErr) {
                global.__SOMA_CHAT_ACTIVE = false;
                console.warn(`[SOMA] Chat timeout after ${SERVER_TIMEOUT}ms for: "${message.substring(0, 40)}"`);
                // Return a graceful timeout response instead of letting the frontend time out
                return res.json({
                    success: true,
                    message: "I'm thinking hard but taking too long — my AI providers may be slow right now. Try again or ask something simpler.",
                    response: "I'm thinking hard but taking too long — my AI providers may be slow right now. Try again or ask something simpler.",
                    metadata: { confidence: 0.3, brain: 'TIMEOUT', error: timeoutErr.message }
                });
            }
            global.__SOMA_CHAT_ACTIVE = false;

            let responseText = result?.text || result?.response || result?.output || (typeof result === 'string' ? result : "I processed your request but couldn't formulate a text response.");

            // ── NEMESIS: Adversarial quality gate — catch hallucinations before they reach the user ──
            let nemesisVerdict = null;
            try {
                // Use shared system.nemesis (created in extended.js, scores persisted to SQLite)
                const nemesis = system.nemesis || null;
                if (nemesis && responseText.length > 30) {
                    // geminiCallback: routes to QuadBrain's LOGOS for the deep linguistic review (Stage 2)
                    const geminiCallback = async (prompt) => {
                        const brain = getBrain();
                        if (!brain) return { text: '' };
                        return brain.reason(prompt, { quickResponse: true, systemOverride: 'nemesis_review' });
                    };
                    nemesisVerdict = await nemesis.evaluateResponse(result?.brain || 'LOGOS', message, result || { text: responseText }, geminiCallback);

                    // Force revision if response completely fails numeric evaluation
                    if (nemesisVerdict?.needsRevision) {
                        const critique = nemesisVerdict.linguistic?.summary || nemesisVerdict.reason || 'Response lacked grounding or had logical issues';
                        const revisionPrompt = `Your previous response had a quality issue: "${critique}"\n\nPlease provide a revised, grounded, accurate response to the original question: "${message.substring(0, 300)}"`;
                        const brain = getBrain();
                        if (brain) {
                            const revised = await brain.reason(revisionPrompt, { quickResponse: true }).catch(() => null);
                            if (revised?.text) {
                                console.log(`[NEMESIS] ✏️  Response revised (score was ${nemesisVerdict.score?.toFixed(2) || '?'})`);
                                // Persist revision pair — premium training data (bad→good + why)
                                nemesis.persistRevisionPair(message, responseText, critique, revised.text, nemesisVerdict.score);
                                responseText = revised.text;
                            }
                        }
                    }
                }
            } catch (nemErr) {
                // Nemesis failure is non-fatal — user still gets original response
            }

            const confidence = result?.confidence || 0.8;

            // ── Memory Storage: Store meaningful exchanges for cross-session recall ──
            if (system.mnemonicArbiter?.remember && message.length > 15 && responseText.length > 20) {
                system.mnemonicArbiter.remember(
                    `User asked: "${message.substring(0, 200)}" → SOMA: "${responseText.substring(0, 300)}"`,
                    { type: 'conversation', importance: 4, sessionId, brain: result?.brain, confidence }
                ).catch(() => {});
            }

            // ── Agent Suggestion: match task intent to collected characters ──
            let characterSuggestion = null;
            if (!mentionMatch && !system.activeCharacter) {
                try {
                    const { getCharacterGenerator } = require('../CharacterGenerator.cjs');
                    const cg = getCharacterGenerator();
                    const col = cg.getCollection();
                    if (col.length > 0) {
                        const intentMap = {
                            code: /\b(code|program|debug|implement|build|fix bug|refactor|function|api|script|compile)\b/i,
                            philosophy: /\b(meaning|purpose|ethics|moral|existential|philosophy|consciousness|why do we)\b/i,
                            creative: /\b(write|draft|compose|story|poem|design|creative|art|draw|sketch|brainstorm)\b/i,
                            science: /\b(research|study|experiment|hypothesis|data|analyze|scientific|evidence|chemistry|physics)\b/i,
                            strategy: /\b(plan|strategy|optimize|roadmap|decision|trade-?off|prioritize|allocate|goal)\b/i,
                            music: /\b(music|song|melody|rhythm|audio|sound|beat|compose|instrument)\b/i,
                            nature: /\b(nature|biology|ecosystem|animal|plant|evolution|climate|environment|ecology)\b/i,
                            security: /\b(security|vulnerability|hack|encrypt|protect|audit|firewall|threat|cyber)\b/i,
                            finance: /\b(market|stock|trade|invest|portfolio|crypto|price|earnings|economy|profit)\b/i,
                            writing: /\b(essay|article|blog|report|document|summary|copy|content|editorial)\b/i,
                            math: /\b(calculate|equation|math|formula|statistics|probability|algebra|geometry|proof)\b/i,
                            history: /\b(history|historical|ancient|century|civilization|war|dynasty|era|when did)\b/i,
                            psychology: /\b(psychology|behavior|cognitive|emotion|mental|therapy|motivation|personality|mindset)\b/i,
                            engineering: /\b(engineer|architecture|system|infrastructure|deploy|scale|performance|database|server)\b/i,
                            humor: /\b(joke|funny|humor|laugh|comedy|meme|pun|witty|roast)\b/i,
                            exploration: /\b(explore|discover|find out|look up|search|investigate|learn about|curious about|what is)\b/i,
                        };

                        let matchedDomain = null;
                        for (const [domain, pattern] of Object.entries(intentMap)) {
                            if (pattern.test(message)) { matchedDomain = domain; break; }
                        }

                        if (matchedDomain) {
                            // Find best character for this domain
                            const candidates = col.filter(c => c.domain?.id === matchedDomain);
                            // If no exact domain match, find closest by personality
                            const pick = candidates.length > 0
                                ? candidates[Math.floor(Math.random() * candidates.length)]
                                : col[Math.floor(Math.random() * col.length)];

                            if (pick) {
                                characterSuggestion = {
                                    id: pick.id,
                                    name: pick.name,
                                    shortName: pick.shortName,
                                    domain: pick.domain,
                                    rarity: pick.rarity,
                                    creatureType: pick.creatureType,
                                    avatarSeed: pick.avatarSeed,
                                    avatarColors: pick.avatarColors,
                                    colorScheme: pick.colorScheme,
                                    matchedDomain,
                                    reason: candidates.length > 0
                                        ? `${pick.shortName} specializes in ${pick.domain?.label}`
                                        : `${pick.shortName} is eager to help with this`
                                };
                            }
                        }
                    }
                } catch {}
            }

            res.json({
                success: true,
                message: responseText,
                response: responseText,
                toolCall: result?.toolCall || null,
                characterSuggestion,
                activeCharacter: system.activeCharacter ? { name: system.activeCharacter.name, shortName: system.activeCharacter.shortName, domain: system.activeCharacter.domain } : null,
                metadata: {
                    confidence,
                    brain: result?.brain || 'System',
                    dissonance: result?.dissonance || null,
                    provenance: result?.provenance || null,
                    toolsUsed: result?.toolsUsed || [],
                    uncertainty: result?.uncertainty || null,
                    nemesis: nemesisVerdict ? {
                        score: nemesisVerdict.score,
                        fate: nemesisVerdict.fate || (nemesisVerdict.needsRevision ? 'REVISED' : 'ALLOW'),
                        revised: nemesisVerdict.needsRevision || false,
                        stage: nemesisVerdict.stage
                    } : null
                }
            });

            // ── Post-Processing Pipeline (non-blocking) ──
            // These fire after response is sent so they don't slow the user down.
            try {
                const postOps = [];

                // 1. Idea Capture — captures every message for resonance scanning
                if (system.ideaCapture && typeof system.ideaCapture.handleRawInput === 'function') {
                    postOps.push(system.ideaCapture.handleRawInput({ text: message, source: 'chat', author: 'user', sessionId }).catch(() => {}));
                }

                // 2. Personality Forge — evolves personality from interaction patterns
                if (system.personalityForge && typeof system.personalityForge.processInteraction === 'function') {
                    postOps.push(system.personalityForge.processInteraction({
                        id: `chat-${Date.now()}`,
                        input: message,
                        output: responseText,
                        metadata: { brain: result?.brain, confidence, sessionId }
                    }).catch(() => {}));
                }

                // 3. Curiosity Extractor — detects uncertain topics & new domains
                if (system.curiosityExtractor && typeof system.curiosityExtractor.extractCuriosityFromExperience === 'function') {
                    postOps.push(system.curiosityExtractor.extractCuriosityFromExperience({
                        state: message,
                        action: responseText,
                        reward: confidence,
                        metadata: { domain: result?.brain || 'general' }
                    }).catch(() => {}));
                }

                // 4. Learning Pipeline — feeds OutcomeTracker + ExperienceReplay + Memory + Planner
                //    One call to logInteraction() routes to ALL learning systems in parallel.
                const feedback = detectImplicitFeedback(message, conversationHistory);
                const responseTime = Date.now() - reasonStartTime;

                if (system.learningPipeline && typeof system.learningPipeline.logInteraction === 'function') {
                    postOps.push(system.learningPipeline.logInteraction({
                        type: 'chat',
                        agent: result?.brain || 'QuadBrain',
                        input: message,
                        output: responseText,
                        context: {
                            sessionId,
                            deepThinking: !!deepThinking,
                            conversationLength: conversationHistory.length,
                            isSimpleChat,
                            activePersona: activePersona?.name || null,
                            activeCharacter: system.activeCharacter?.name || null
                        },
                        metadata: {
                            success: feedback.success,
                            userSatisfaction: feedback.userSatisfaction * confidence,
                            userCorrected: feedback.userCorrected,
                            efficient: responseTime < 10000,
                            slow: responseTime > 15000,
                            userQuery: true,
                            novel: conversationHistory.length === 0,
                            confidence,
                            brain: result?.brain,
                            responseTime,
                            toolsUsed: result?.toolsUsed || [],
                            dissonance: result?.dissonance,
                            uncertainty: result?.uncertainty
                        }
                    }).catch(e => console.warn('[SOMA] Learning pipeline error:', e.message)));
                } else if (system.outcomeTracker && typeof system.outcomeTracker.recordOutcome === 'function') {
                    // Fallback: direct OutcomeTracker if pipeline not loaded yet (first 5 min of boot)
                    // Note: recordOutcome() is synchronous — wrap in try/catch, not .catch()
                    try {
                        system.outcomeTracker.recordOutcome({
                            agent: result?.brain || 'QuadBrain',
                            action: 'chat',
                            result: responseText.substring(0, 500),
                            reward: (feedback.userSatisfaction * confidence) - (feedback.userCorrected ? 0.5 : 0),
                            success: feedback.success,
                            context: { query: message.substring(0, 200), sessionId },
                            duration: responseTime,
                            metadata: { brain: result?.brain, confidence, responseTime }
                        });
                        console.log(`[SOMA] Outcome recorded: satisfaction=${(feedback.userSatisfaction).toFixed(2)} corrected=${feedback.userCorrected} brain=${result?.brain}`);
                    } catch (otErr) {
                        console.warn('[SOMA] OutcomeTracker error:', otErr.message);
                    }
                }

                // 5. Fragment Learning — route outcome to matching fragment brain
                //    Updates fragment expertise, triggers genesis for new domains,
                //    enables mitosis when fragments get expert enough.
                if (system.fragmentRegistry && typeof system.fragmentRegistry.routeToFragment === 'function') {
                    const brain = result?.brain || 'LOGOS';
                    const pillar = ['LOGOS','AURORA','THALAMUS','PROMETHEUS'].includes(brain) ? brain : 'LOGOS';
                    postOps.push((async () => {
                        try {
                            const match = await system.fragmentRegistry.routeToFragment(message, pillar);
                            if (match && match.fragment) {
                                // Feed outcome to the matched fragment — this is how fragments learn
                                await system.fragmentRegistry.recordFragmentOutcome(match.fragment.id, {
                                    query: message,
                                    response: responseText.substring(0, 500),
                                    success: feedback.success,
                                    confidence,
                                    reward: (feedback.userSatisfaction * confidence) - (feedback.userCorrected ? 0.5 : 0)
                                });
                                console.log(`[SOMA] Fragment ${match.fragment.domain}/${match.fragment.specialization} learned (expertise: ${match.fragment.expertiseLevel.toFixed(2)})`);
                            } else {
                                // No matching fragment — consider spawning a new one
                                await system.fragmentRegistry.considerAutoSpawn(message, pillar);
                            }
                        } catch (fragErr) {
                            // Fragment errors must never block chat
                        }
                    })());
                }

                // 6. Gist Arbiter — auto-compacts long conversations
                if (system.gistArbiter && typeof system.gistArbiter.checkCompactionNeeded === 'function' && conversationHistory.length > 0) {
                    postOps.push(system.gistArbiter.checkCompactionNeeded(conversationHistory).catch(() => {}));
                }

                // 7. Conversation History — persistent memory across sessions
                if (system.conversationHistory && typeof system.conversationHistory.addMessage === 'function') {
                    postOps.push(
                        system.conversationHistory.addMessage('user', message, { sessionId }).catch(() => {}),
                        system.conversationHistory.addMessage('assistant', responseText, { sessionId }).catch(() => {})
                    );
                }

                // 8. Theory of Mind — update user mental model from interaction
                if (system.theoryOfMind && typeof system.theoryOfMind.handleUserMessage === 'function') {
                    postOps.push(system.theoryOfMind.handleUserMessage({
                        userId: sessionId || 'default_user',
                        message,
                        context: { sessionId, brain: result?.brain }
                    }).catch(() => {}));
                }

                if (postOps.length > 0) await Promise.all(postOps);
            } catch (postErr) {
                // Post-processing errors must never affect the user
                console.warn('[SOMA] Post-processing error (non-fatal):', postErr.message);
            }

        } catch (error) {
            console.error('[SOMA] Chat Error:', error);
            const errMsg = `I hit an internal error: ${error.message}. I'm still here though — try again.`;
            res.json({
                success: true,
                message: errMsg,
                response: errMsg,
                metadata: { confidence: 0.1, brain: 'ERROR', error: error.message }
            });
        }
    });

    // POST /api/soma/feedback — explicit user feedback (thumbs up/down, rating)
    // Feeds into LearningPipeline → OutcomeTracker → ExperienceReplay → Memory
    router.post('/feedback', async (req, res) => {
        try {
            const { sessionId, messageTimestamp, rating, comment } = req.body;
            if (rating === undefined && !comment) {
                return res.status(400).json({ success: false, error: 'rating or comment required' });
            }

            // Normalize: accept 1/-1 (thumbs), 0-1 (scale), or 0-5 (stars)
            let reward = 0;
            if (typeof rating === 'number') {
                if (rating > 1) reward = (rating / 5) * 2 - 1;    // 0-5 stars → -1 to 1
                else reward = Math.max(-1, Math.min(1, rating));   // already -1 to 1
            }

            const interactionData = {
                type: 'feedback',
                agent: 'user',
                input: comment || `User rated response: ${rating}`,
                output: null,
                context: { sessionId, messageTimestamp },
                metadata: {
                    userSatisfaction: (reward + 1) / 2,  // normalize to 0-1 for calculateReward()
                    success: reward > 0,
                    userCorrected: reward < 0,
                    critical: true                        // high importance for memory storage
                }
            };

            if (system.learningPipeline && typeof system.learningPipeline.logInteraction === 'function') {
                await system.learningPipeline.logInteraction(interactionData);
            } else if (system.outcomeTracker && typeof system.outcomeTracker.recordOutcome === 'function') {
                // recordOutcome is synchronous — no await needed
                system.outcomeTracker.recordOutcome({
                    agent: 'user',
                    action: 'feedback',
                    reward,
                    success: reward > 0,
                    context: { sessionId, messageTimestamp },
                    metadata: { comment, rating }
                });
            }

            console.log(`[SOMA] Feedback recorded: rating=${rating} reward=${reward.toFixed(2)} session=${sessionId || 'none'}`);
            res.json({ success: true, recorded: true, reward });
        } catch (error) {
            console.error('[SOMA] Feedback error:', error.message);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // POST /api/soma/shell/exec — with approval gate for risky commands
    router.post('/shell/exec', async (req, res) => {
        try {
            const { command } = req.body;
            if (command.includes('rm -rf') || command.includes(':(){:|:&};:')) return res.status(400).json({ error: 'Blocked' });

            // Approval gate — risky commands need user OK
            const gate = system.ws?.approvalGate;
            if (gate) {
                const riskScore = gate.scoreRisk(command, 'shell');
                if (riskScore >= 0.4) {
                    const approval = await gate.request({
                        action: `Execute: ${command.substring(0, 100)}`,
                        type: 'shell',
                        details: { command, cwd: process.cwd() },
                        riskScore,
                        trustScore: riskScore < 0.5 ? 0.7 : 0.3
                    });
                    if (!approval.approved) {
                        return res.json({ success: false, output: `[DENIED] Command not approved: ${approval.reason}`, cwd: process.cwd() });
                    }
                }
            }

            exec(command, { timeout: 5000 }, (error, stdout, stderr) => {
                res.json({ success: !error, output: stdout || stderr, cwd: process.cwd() });
            });
        } catch (error) { res.status(500).json({ error: error.message }); }
    });

    // POST /api/soma/vision/analyze
    router.post('/vision/analyze', async (req, res) => {
        try {
            const { query, file } = req.body;
            const brain = getBrain();
            if (!brain) return res.status(503).json({ error: 'Brain offline' });
            
            const result = await brain.reason(`Analyze image: ${query}
[Image: ${file.name}]`, { vision: true });
            res.json({ success: true, analysis: result.text });
        } catch (error) { res.status(500).json({ error: error.message }); }
    });

    // GET /api/soma/vision/last
    // ... (rest of the file)


    // Memory Excavation (Section 4.1 of Cognitive Restoration)
    router.get('/memory/excavate', async (req, res) => {
        try {
            const limit = parseInt(req.query.limit) || 20;
            const memories = await system.mnemonic.getRecentColdMemories(limit);
            res.json({ success: true, memories });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Promote Memory to Fractal Knowledge
    router.post('/memory/promote', async (req, res) => {
        try {
            const { memoryId, label, importance } = req.body;
            
            // 1. Get the memory content
            const search = await system.mnemonic.recall(memoryId, 1);
            const memory = search.results[0];
            
            if (!memory) return res.status(404).json({ success: false, error: 'Memory not found' });

            // 2. Create a permanent fractal node
            const node = await system.knowledge.createNode({
                label: label || 'Excavated Concept',
                content: memory.content,
                sourceId: memoryId,
                importance: importance || 8,
                type: 'concept',
                domain: 'AURORA'
            });

            // 3. Update the cold memory importance
            await system.mnemonic.remember(memory.content, { 
                ...memory.metadata, 
                importance: 1.0,
                promotedToFractal: true,
                fractalId: node.id
            });

            res.json({ success: true, node });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // POST /api/soma/fs/read
    router.post('/fs/read', async (req, res) => {
        try {
            const { path: fpath } = req.body;
            if (!fs.existsSync(fpath)) return res.status(404).json({ success: false, error: 'File not found' });

            const stats = fs.statSync(fpath);
            const MAX_SIZE = 5 * 1024 * 1024; // 5MB Limit for UI preview
            
            if (stats.size > MAX_SIZE) {
                // Read only the first 50KB if file is too large
                const stream = fs.createReadStream(fpath, { start: 0, end: 50000 });
                let content = '';
                for await (const chunk of stream) {
                    content += chunk.toString();
                }
                return res.json({ 
                    success: true, 
                    content: content + "\n\n[TRUNCATED: File too large for preview]", 
                    truncated: true,
                    size: stats.size
                });
            }

            const content = fs.readFileSync(fpath, 'utf8');
            res.json({ success: true, content, size: stats.size });
        } catch (error) { res.status(500).json({ error: error.message }); }
    });

    // POST /api/soma/fs/search — real recursive search
    router.post('/fs/search', async (req, res) => {
        try {
            const { query, directory, extensions } = req.body;
            if (!query) return res.status(400).json({ success: false, error: 'query required' });

            const searchDir = directory || process.cwd();
            const results = [];
            const maxResults = 100;
            const extFilter = extensions ? extensions.map(e => e.toLowerCase()) : null;

            const walk = (dir, depth = 0) => {
                if (depth > 8 || results.length >= maxResults) return; // Cap depth and results
                try {
                    const entries = fs.readdirSync(dir, { withFileTypes: true });
                    for (const entry of entries) {
                        if (results.length >= maxResults) break;
                        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
                        
                        const fullPath = path.join(dir, entry.name);
                        if (entry.isDirectory()) {
                            walk(fullPath, depth + 1);
                        } else {
                            const ext = path.extname(entry.name).toLowerCase();
                            if (extFilter && !extFilter.includes(ext)) continue;
                            
                            // Filename match
                            if (entry.name.toLowerCase().includes(query.toLowerCase())) {
                                results.push({ name: entry.name, path: fullPath, type: 'filename_match' });
                            } 
                        }
                    }
                } catch (e) { /* skip inaccessible */ }
            };

            walk(searchDir);
            res.json({ success: true, results });
        } catch (error) { res.status(500).json({ success: false, error: error.message }); }
    });

    // POST /api/soma/fs/operate — file operations (create, rename, delete, copy)
    router.post('/fs/operate', async (req, res) => {
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
                    fs.writeFileSync(safe(sourcePath), content || '', 'utf8');
                    return res.json({ success: true, message: `Created ${sourcePath}` });
                case 'rename':
                    fs.renameSync(safe(sourcePath), safe(destPath));
                    return res.json({ success: true, message: `Renamed to ${destPath}` });
                case 'copy':
                    fs.copyFileSync(safe(sourcePath), safe(destPath));
                    return res.json({ success: true, message: `Copied to ${destPath}` });
                case 'delete':
                    fs.unlinkSync(safe(sourcePath));
                    return res.json({ success: true, message: `Deleted ${sourcePath}` });
                case 'mkdir':
                    fs.mkdirSync(safe(sourcePath), { recursive: true });
                    return res.json({ success: true, message: `Created directory ${sourcePath}` });
                default:
                    return res.status(400).json({ success: false, error: `Unknown operation: ${operation}` });
            }
        } catch (error) { res.status(500).json({ success: false, error: error.message }); }
    });

     // POST /api/soma/code/task
    router.post('/code/task', async (req, res) => {
         try {
            const { task, files } = req.body;
            const result = await brain.reason(`Write code for: ${task}`, { code: true });
            res.json({ success: true, code: result.text, explanation: "Generated by SOMA" });
        } catch (error) { res.status(500).json({ error: error.message }); }
    });

    // GET /api/soma/gmn/nodes
    // List connected Graymatter Network nodes
    router.get('/gmn/nodes', async (req, res) => {
        try {
            const thalamus = system.localThalamus;
            const nodes = [];
            
            // Add local node
            if (thalamus) {
                nodes.push({
                    id: 'local-node',
                    name: 'Primary Command Bridge',
                    address: thalamus.nodeAddress || 'localhost',
                    status: 'online',
                    latency: '0ms',
                    reputation: 1.0,
                    isLocal: true
                });

                // Add nodes from reputation store
                if (thalamus.reputationStore) {
                    for (const [nodeId, data] of thalamus.reputationStore.entries()) {
                        nodes.push({
                            id: nodeId,
                            name: `Node-${nodeId.substring(0, 6)}`,
                            address: `${nodeId.toLowerCase()}.gmn.somaexample.cd`,
                            status: 'online',
                            latency: `${Math.floor(Math.random() * 50) + 10}ms`,
                            reputation: (data.usefulness + data.consistency) / 2,
                            isLocal: false
                        });
                    }
                }
            }

            // Seed with some mock external nodes if store is empty for better UI demo
            if (nodes.length <= 1) {
                nodes.push(
                    { id: 'alpha-node', name: 'Neural-Alpha', address: 'alpha.gmn.somaexample.cd', status: 'online', latency: '42ms', reputation: 0.95, isLocal: false },
                    { id: 'bear-bridge', name: 'Bear-Bridge-Node', address: 'bear.gmn.somaexample.cd', status: 'standby', latency: '128ms', reputation: 0.82, isLocal: false },
                    { id: 'imac-core', name: 'iMac-Cortex-01', address: 'imac.gmn.somaexample.cd', status: 'busy', latency: '15ms', reputation: 0.99, isLocal: false }
                );
            }

            res.json({ success: true, nodes });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    return router;
}
