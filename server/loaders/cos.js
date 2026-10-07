/**
 * loaders/cos.js - Cognitive Operating System Loader
 * 
 * Initializes the Perception Layer (Daemons), Attention Engine, Engineering Swarm, 
 * Curiosity Reactor (Wandering Mind), and Metabolism (Memory Pruner).
 * This is SOMA's "Perception & Action" nervous system.
 */

import AttentionArbiter from '../../arbiters/AttentionArbiter.js';
import EngineeringSwarmArbiter from '../../arbiters/EngineeringSwarmArbiter.js';
import SwarmOptimizer from '../../arbiters/SwarmOptimizer.js';
import DiscoverySwarm from '../../arbiters/DiscoverySwarm.js';
import CuriosityReactor from '../../core/CuriosityReactor.js';
import { RecoveryCortex, FailureScenario } from '../../core/RecoveryCortex.js';
import { SomaPolicyEngine } from '../../core/SomaPolicyEngine.js';
import RepoWatcherDaemon from '../../daemons/RepoWatcherDaemon.js';
import HealthDaemon from '../../daemons/HealthDaemon.js';
import OptimizationDaemon from '../../daemons/OptimizationDaemon.js';
import DiscoveryDaemon from '../../daemons/DiscoveryDaemon.js';
import MemoryPrunerDaemon from '../../daemons/MemoryPrunerDaemon.js';
import MemoryDistillerDaemon from '../../daemons/MemoryDistillerDaemon.js';
import CuriosityDaemon from '../../daemons/CuriosityDaemon.js';
import DreamConsolidationDaemon from '../../daemons/DreamConsolidationDaemon.js';
import SocialImpulseDaemon from '../../daemons/SocialImpulseDaemon.js';
import SocialIntelDaemon from '../../daemons/SocialIntelDaemon.js';
import SocialSchedulerDaemon from '../../daemons/SocialSchedulerDaemon.js';
import SocialEngagementDaemon from '../../daemons/SocialEngagementDaemon.js';
import GoalExecutorDaemon from '../../daemons/GoalExecutorDaemon.js';
import DaemonManager from '../../core/DaemonManager.js';
import CapabilityDiscoveryDaemon from '../../daemons/CapabilityDiscoveryDaemon.js';
import WebPerceptionDaemon from '../../daemons/WebPerceptionDaemon.js';
import VisionDaemon from '../../daemons/VisionDaemon.js';
import ProactivePerceptionArbiter from '../../arbiters/ProactivePerceptionArbiter.js';
import SelfReflectionArbiter from '../../arbiters/SelfReflectionArbiter.js';
import { VisualMemoryArbiter } from '../../arbiters/VisualMemoryArbiter.js';
import KnowledgeCuratorArbiter from '../../arbiters/KnowledgeCuratorArbiter.js';
import blueskeyClient from '../../server/social/BlueskeyClient.js';
import linkedInClient from '../../server/social/LinkedInClient.js';
import TradingConnectionMonitorDaemon from '../../daemons/TradingConnectionMonitorDaemon.js';
import { VisualObjectMemory } from '../../core/VisualObjectMemory.js';

export async function loadCOSSystems(system) {
    console.log('\n[Loader] 🧠 Initializing Cognitive Operating System (COS) Layer...');

    try {
        // 1. Daemon Manager (The Supervisor with Watchdog)
        const daemonManager = new DaemonManager({ logger: console });
        system.daemonManager = daemonManager;

        const policyEngine = new SomaPolicyEngine();
        const recoveryCortex = new RecoveryCortex({ messageBroker: system.messageBroker });
        system.policyEngine = policyEngine;
        system.recoveryCortex = recoveryCortex;

        // 2. Attention Engine - Wired as CNS gate BEFORE daemons start
        const attentionArbiter = new AttentionArbiter({
            messageBroker: system.messageBroker,
            quadBrain: system.quadBrain
        });
        await attentionArbiter.initialize();
        if (system.messageBroker) {
            system.messageBroker.attentionEngine = attentionArbiter;
        }
        console.log('      ✅ AttentionArbiter wired as CNS gate (prevents arbiter storms)');

        // 3. Engineering Swarm - Full research/plan/debate/synthesis cycle
        const engineeringSwarm = new EngineeringSwarmArbiter({
            name: 'EngineeringSwarmArbiter',
            quadBrain: system.quadBrain,
            rootPath: process.cwd(),
            mnemonicArbiter: system.mnemonic || system.mnemonicArbiter  // experience ledger → long-term memory
        });
        await engineeringSwarm.initialize();
        system.messageBroker.registerArbiter('EngineeringSwarmArbiter', {
            instance: engineeringSwarm,
            role: 'implementer',
            lobe: 'motor_cortex',
            classification: 'engineering'
        });
        system.engineeringSwarm = engineeringSwarm;
        if (system.arbiters) system.arbiters.set('engineeringSwarm', engineeringSwarm);
        console.log('      ✅ EngineeringSwarmArbiter online (Verified Transactional Execution)');

        // 4. Swarm Optimizer - Hourly performance analysis + self-improvement
        const swarmOptimizer = new SwarmOptimizer({
            name: 'SwarmOptimizer',
            swarm: engineeringSwarm,
            quadBrain: system.quadBrain
        });
        await swarmOptimizer.initialize();
        if (engineeringSwarm.setOptimizer) {
            engineeringSwarm.setOptimizer(swarmOptimizer);
        }
        system.messageBroker.registerArbiter('SwarmOptimizer', {
            instance: swarmOptimizer,
            role: 'analyst',
            lobe: 'prefrontal',
            classification: 'optimizer'
        });
        system.swarmOptimizer = swarmOptimizer;
        if (system.arbiters) system.arbiters.set('swarmOptimizer', swarmOptimizer);
        console.log('      ✅ SwarmOptimizer wired (self-improvement loop ACTIVE)');

        // 5. Discovery Swarm - Autonomous capability invention
        const discoverySwarm = new DiscoverySwarm({
            name: 'DiscoverySwarm',
            engineering: engineeringSwarm,
            quadBrain: system.quadBrain
        });
        await discoverySwarm.initialize();
        system.messageBroker.registerArbiter('DiscoverySwarm', {
            instance: discoverySwarm,
            role: 'scout',
            lobe: 'prefrontal',
            classification: 'discovery'
        });
        system.discoverySwarm = discoverySwarm;
        if (system.arbiters) system.arbiters.set('discoverySwarm', discoverySwarm);
        console.log('      ✅ DiscoverySwarm online (capability invention scan ACTIVE)');

        // 6. Curiosity Reactor (The Wandering Mind)
        const curiosityReactor = new CuriosityReactor({
            quadBrain: system.quadBrain,
            messageBroker: system.messageBroker,
            logger: console
        });
        system.messageBroker.registerArbiter('CuriosityReactor', {
            instance: curiosityReactor,
            role: 'thinker',
            lobe: 'limbic',
            classification: 'curiosity'
        });
        system.curiosityReactor = curiosityReactor;
        if (system.arbiters) system.arbiters.set('curiosityReactor', curiosityReactor);
        console.log('      ✅ Curiosity Reactor active (Daydreaming enabled)');

        // 7. Register & Start Daemons
        daemonManager.register(new RepoWatcherDaemon({ root: process.cwd() }));
        daemonManager.register(new HealthDaemon({ intervalMs: 30000 }));
        
        // Metabolism: Prune memory every 12 hours
        daemonManager.register(new MemoryPrunerDaemon({ 
            mnemonic: system.mnemonic || system.mnemonicArbiter,
            quadBrain: system.quadBrain,
            intervalMs: 43200000 
        }));

        // Dreaming: Distill memories into wisdom daily
        const memoryDistiller = new MemoryDistillerDaemon({
            system,
            intervalMs: 86400000 
        });
        daemonManager.register(memoryDistiller);
        system.memoryDistiller = memoryDistiller;

        // Consolidation: Consolidate short-term memories and adapt traits every 4 hours
        daemonManager.register(new DreamConsolidationDaemon({
            system,
            intervalMs: 4 * 60 * 60 * 1000
        }));

        // Daydream: Generate hypotheses every 2 hours
        daemonManager.register(new CuriosityDaemon({
            reactor: curiosityReactor,
            discovery: discoverySwarm,
            messageBroker: system.messageBroker,
            intervalMs: 7200000
        }));

        // Social: Proactively greet Owner when he's active
        const socialImpulse = new SocialImpulseDaemon({
            messageBroker: system.messageBroker,
            quadBrain: system.quadBrain,
            vision: system.visionArbiter || system.visionProcessing,
            intervalMs: 300000 // 5 minutes
        });
        daemonManager.register(socialImpulse);
        system.socialImpulse = socialImpulse;
        if (system.arbiters) system.arbiters.set('socialImpulse', socialImpulse);

        const socialBrowser = system.oculusBrowser || system.somaBrowser || system.browser || null;

        // Social: public learning loop (harvest -> queue -> post -> score -> adapt)
        const socialIntel = new SocialIntelDaemon({
            brain: system.quadBrain,
            browserArbiter: socialBrowser,
            intervalMs: parseInt(process.env.SOMA_SOCIAL_INTEL_INTERVAL_MS || `${60 * 60_000}`, 10)
        });
        daemonManager.register(socialIntel);
        system.socialIntel = socialIntel;
        if (system.arbiters) system.arbiters.set('socialIntel', socialIntel);

        const socialScheduler = new SocialSchedulerDaemon({
            browserArbiter: socialBrowser,
            intervalMs: parseInt(process.env.SOMA_SOCIAL_SCHEDULER_INTERVAL_MS || `${2 * 60_000}`, 10)
        });
        daemonManager.register(socialScheduler);
        system.socialScheduler = socialScheduler;
        if (system.arbiters) system.arbiters.set('socialScheduler', socialScheduler);

        const socialEngagement = new SocialEngagementDaemon({
            brain: system.quadBrain,
            blueskeyClient,
            linkedInClient,
            browserArbiter: socialBrowser,
            intervalMs: parseInt(process.env.SOMA_SOCIAL_ENGAGEMENT_INTERVAL_MS || `${15 * 60_000}`, 10)
        });
        daemonManager.register(socialEngagement);
        system.socialEngagement = socialEngagement;
        if (system.arbiters) system.arbiters.set('socialEngagement', socialEngagement);

        // Goal execution fallback: AutonomousHeartbeat is the primary agentic loop.
        // This daemon remains supervised so pending/proposed goals can still move
        // if the pulse is disabled or stopped.
        const goalExecutorDaemon = new GoalExecutorDaemon({
            system,
            intervalMs: parseInt(process.env.SOMA_GOAL_EXECUTOR_INTERVAL_MS || `${5 * 60_000}`, 10)
        });
        daemonManager.register(goalExecutorDaemon);
        system.goalExecutorDaemon = goalExecutorDaemon;

        daemonManager.register(new OptimizationDaemon({
            optimizer: swarmOptimizer,
            intervalMs: 3600000 // hourly
        }));
        
        daemonManager.register(new DiscoveryDaemon({
            discovery: discoverySwarm,
            intervalMs: 86400000 // daily
        }));

        // Initialize VisionProcessingArbiter (CLIP classification engine)
        let visionProcessing = system.arbiters?.get('VisionProcessingArbiter');
        if (!visionProcessing) {
            try {
                const { VisionProcessingArbiter } = await import('../../arbiters/VisionProcessingArbiter.js');
                visionProcessing = new VisionProcessingArbiter({
                    name: 'VisionProcessingArbiter',
                    messageBroker: system.messageBroker,
                    quadBrain: system.quadBrain
                });
                await visionProcessing.initialize();
                system.visionProcessing = visionProcessing;
                if (system.arbiters) {
                    system.arbiters.set('VisionProcessingArbiter', visionProcessing);
                }
            } catch (err) {
                console.warn('[Loader] VisionProcessingArbiter initialization skipped:', err.message);
            }
        }

        // 👁️ Vision: Persistent perception (Desktop/Webcam)
        const visualObjectMemory = new VisualObjectMemory().initialize();
        system.visualObjectMemory = visualObjectMemory;
        const visionDaemon = new VisionDaemon({
            name: 'VisionDaemon',
            intervalMs: 5000, // 5s poll — don't destroy CLIP/CPU on boot
            computerControl: system.arbiters?.get('ComputerControlArbiter'),
            visionProcessing: visionProcessing || system.arbiters?.get('VisionProcessingArbiter'),
            messageBroker: system.messageBroker,
            objectMemory: visualObjectMemory
        });
        daemonManager.register(visionDaemon);
        system.visionDaemon = visionDaemon;

        // VisualMemoryArbiter — tags and organizes what SOMA sees (user presence, room type)
        const visualMemory = new VisualMemoryArbiter({
            messageBroker: system.messageBroker,
            mnemonicArbiter: system.mnemonicArbiter,
            visionArbiter: null // wired later by extended.js
        });
        system.visualMemory = visualMemory;
        if (system.arbiters) system.arbiters.set('visualMemory', visualMemory);

        // Self-healing: probe every registered capability every 60s
        const capabilityDaemon = new CapabilityDiscoveryDaemon({
            name: 'CapabilityDiscoveryDaemon',
            rootPath: process.cwd(),
            intervalMs: 60000
        });
        daemonManager.register(capabilityDaemon);
        system.capabilityDaemon = capabilityDaemon;

        // Web perception: persistent URL watchdog (watch list populated at runtime)
        const webPerceptionDaemon = new WebPerceptionDaemon({
            name: 'WebPerceptionDaemon',
            rootPath: process.cwd(),
            intervalMs: 30000
        });
        daemonManager.register(webPerceptionDaemon);
        system.webPerceptionDaemon = webPerceptionDaemon;

        // Trading Connection Monitor (Cancel-on-Disconnect guard)
        if (process.env.SOMA_LOAD_TRADING === 'true') {
            const codMonitor = new TradingConnectionMonitorDaemon();
            daemonManager.register(codMonitor);
            system.tradingConnectionMonitor = codMonitor;
            console.log('      ✅ TradingConnectionMonitorDaemon registered (Cancel-on-Disconnect guard active)');
        }

        // Proactive Perception — personality layer for visual data
        const proactivePerception = new ProactivePerceptionArbiter({
            messageBroker: system.messageBroker,
            mnemonicArbiter: system.mnemonic || system.mnemonicArbiter,
            identityArbiter: system.identityArbiter
        });
        await proactivePerception.initialize();
        system.messageBroker.registerArbiter('ProactivePerceptionArbiter', {
            instance: proactivePerception,
            role: 'personality',
            lobe: 'limbic',
            classification: 'personality'
        });
        system.proactivePerception = proactivePerception;

        // 7. Initialize Self-Reflection (The Wisdom Layer)
        const reflectionArbiter = new SelfReflectionArbiter({
            messageBroker: system.messageBroker,
            quadBrain: system.quadBrain
        });
        await reflectionArbiter.initialize();
        system.messageBroker.registerArbiter('SelfReflectionArbiter', {
            instance: reflectionArbiter,
            role: 'analyst',
            lobe: 'prefrontal',
            classification: 'wisdom'
        });
        system.reflectionArbiter = reflectionArbiter;
        if (system.arbiters) system.arbiters.set('reflectionArbiter', reflectionArbiter);
        console.log('      ✅ Self-Reflection motive active (Daily wisdom synthesis)');

        // ── Knowledge Curator — auto-files signals into lobe MD libraries ──
        const knowledgeCurator = new KnowledgeCuratorArbiter({
            messageBroker: system.messageBroker,
        });
        system.knowledgeCurator = knowledgeCurator;
        if (system.arbiters) system.arbiters.set('knowledgeCurator', knowledgeCurator);
        system.messageBroker.registerArbiter('KnowledgeCuratorArbiter', {
            instance: knowledgeCurator,
            role: 'librarian',
            lobe: 'hippocampus',
            classification: 'knowledge'
        });
        console.log('      ✅ KnowledgeCuratorArbiter online (lobe knowledge libraries active)');

        // Expose COS subsystems globally so perceptionRoutes.js can access them
        // without circular imports (same pattern as global.SOMA_TRADING)
        global.SOMA_COS = {
            capabilityDaemon,
            webPerceptionDaemon,
            visionDaemon,
            proactivePerception,
            attentionArbiter,
            knowledgeCurator,
            reflectionArbiter,
            socialIntel,
            socialScheduler,
            socialEngagement,
            policyEngine,
            recoveryCortex,
            tradingConnectionMonitor: system.tradingConnectionMonitor || null
        };

        await daemonManager.startAll();

        // 8. Wire Signal Reactions (CNS Drivers)
        system.messageBroker.subscribe('swarm.optimization.needed', async (signal) => {
            console.log('[SOMA] 📊 Swarm optimization signal — running improvement cycle...');
            const result = await swarmOptimizer.improve().catch(err => {
                console.warn('[SOMA] SwarmOptimizer.improve() failed:', err.message);
                return { success: false, error: err.message };
            });
            // Feed improvement result back to CNS
            system.messageBroker.publish('experiment.result', {
                experimentId: `swarm_opt_${Date.now()}`,
                success: result?.success || false,
                filepath: result?.filepath || 'arbiters/EngineeringSwarmArbiter.js'
            }).catch(() => {});
        });

        system.messageBroker.subscribe('swarm.discovery.ideas', async (signal) => {
            const ideas = signal.payload?.ideas || [];
            console.log(`[SOMA] 💡 DiscoverySwarm: ${ideas.length} idea(s) — prototyping top 3`);
            for (const idea of ideas.slice(0, 3)) {
                await discoverySwarm.prototype(idea).catch(err =>
                    console.warn(`[SOMA] Prototype failed for ${idea.name}: ${err.message}`)
                );
            }
        });

        system.messageBroker.subscribe('health.warning', (signal) => {
            console.warn(`[SOMA] 🏥 Health warning [${signal.source}]: ${JSON.stringify(signal.payload)}`);
            system.anomalyDetector?.record?.({
                type: 'health_warning',
                payload: signal.payload,
                source: signal.source
            });
        });

        // Memory Pressure — reactively flush MnemonicArbiter warm tier when RSS > 85%
        system.messageBroker.subscribe('system.resource.critical', (signal) => {
            const { issue, rssPercent } = signal?.payload || {};
            if (issue !== 'HIGH_RSS') return;

            const policyActions = policyEngine.evaluate({
                rssPercent,
                heapUsage: process.memoryUsage().heapUsed / process.memoryUsage().heapTotal
            });
            if (policyActions.length) {
                system.messageBroker.emitSignal('system.policy.actions', { actions: policyActions }, 'high', 'SomaPolicyEngine');
            }

            const mnemonic = system.mnemonic || system.mnemonicArbiter;
            if (!mnemonic?.flushToCold) return;
            console.warn(`[SOMA] 🧠 Memory pressure (RSS ${rssPercent?.toFixed(1)}%) — triggering warm-tier flush`);
            const evicted = mnemonic.flushToCold(rssPercent > 90);
            console.log(`[SOMA] 🧠 Memory pressure flush complete — ${evicted} vectors evicted`);
            recoveryCortex.handleFailure(FailureScenario.HEAP_PRESSURE, { issue, rssPercent }).catch(() => {});
            // Shift attention to memory management briefly — low-priority signals get shed
            attentionArbiter.setFocus('memory_management', 30000);
        });

        // Capability Discovery — log degradations + shift attention for repair
        system.messageBroker.subscribe('capability.degraded', (signal) => {
            const { capability, note, recommendation } = signal?.payload || {};
            console.warn(`[SOMA] 🔴 Capability DEGRADED: ${capability} — ${note || 'no detail'}`);
            if (recommendation) console.warn(`[SOMA]    Fix: ${recommendation}`);
            system.anomalyDetector?.record?.({ type: 'capability_degraded', capability, note });
            if (capability === 'ollama' || capability === 'deepseek_key') {
                recoveryCortex.handleFailure(FailureScenario.PROVIDER_FAILURE, { capability, note }).catch(() => {});
            }
            // Focus on system health for 2 min — lets repair-related signals through
            attentionArbiter.setFocus('system_health', 120000);
        });

        system.messageBroker.subscribe('capability.restored', (signal) => {
            const { capability, note } = signal?.payload || {};
            console.log(`[SOMA] 🟢 Capability RESTORED: ${capability} — ${note || 'no detail'}`);
            // Return to general focus when things recover
            if (attentionArbiter.focusTopic === 'system_health') {
                attentionArbiter.setFocus('general', 0);
            }
        });

        // Web Perception — shift attention to the topic that changed, route to GoalPlanner
        system.messageBroker.subscribe('web.perception.delta', (signal) => {
            const { url, label, changeCount } = signal?.payload || {};
            console.log(`[SOMA] 🌐 Web change #${changeCount}: ${label || url}`);
            // Shift attention toward the label topic for 5 min so related signals get priority
            const focusTopic = (label || url).toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 30);
            attentionArbiter.setFocus(focusTopic, 300000);
            // Forward to GoalPlannerArbiter if loaded — it matches deltas to active goals
            system.messageBroker.sendMessage({
                from: 'WebPerceptionDaemon',
                to:   'GoalPlannerArbiter',
                type: 'web_delta',
                payload: signal?.payload || {}
            }).catch(() => {}); // non-fatal if GoalPlanner not loaded
        });

        // Goal created — focus attention on the goal's domain for 10 min
        system.messageBroker.subscribe('goal.created', (signal) => {
            const { category, title } = signal?.payload || {};
            const focusTopic = category || (title || '').toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 30);
            if (focusTopic) attentionArbiter.setFocus(focusTopic, 600000);
        });

        // Wire DaemonManager crashes → health.warning + diagnostic.anomaly
        daemonManager.on('daemon.restarted', ({ name, reason, attempt }) => {
            system.messageBroker.publish('health.warning', {
                issue: 'daemon_restarted',
                details: `${name} restarted (${reason || 'crash'}) attempt #${attempt || 1}`
            }).catch(() => {});
            if ((attempt || 1) >= 3) {
                system.messageBroker.publish('diagnostic.anomaly', {
                    component: name,
                    issue: 'repeated_crashes',
                    severity: 'high'
                }).catch(() => {});
            }
        });

        // self:kpi_update → stimulate curiosity for weak components
        system.messageBroker.subscribe('self:kpi_update', (signal) => {
            const { components } = signal.payload || {};
            const curiosity = system.curiosityEngine;
            if (!curiosity || !components) return;
            for (const [comp, score] of Object.entries(components)) {
                if (score < 0.4) {
                    curiosity.stimulateCuriosity({ topic: comp, source: 'self_model', strength: 1 - score });
                }
            }
        });

        // insight.generated (ThoughtNetwork synthesis) → stimulate curiosity + create exploration goal
        system.messageBroker.subscribe('insight.generated', (signal) => {
            const { insight, source, rationale, parents } = signal.payload || {};
            if (!insight) return;

            // Feed curiosity queue — existing behaviour
            const curiosity = system.curiosityEngine;
            if (curiosity?.addToCuriosityQueue) {
                curiosity.addToCuriosityQueue({
                    type: 'adjacent_exploration',
                    question: `What are the implications of the concept: ${insight}?`,
                    gap: insight,
                    priority: 0.65,
                    novel: true
                });
            }

            // Also create a GoalPlanner goal so SOMA actively works on the new concept
            const gp = system.goalPlanner;
            if (gp?.createGoal) {
                const parentCtx = parents?.length ? ` (synthesized from: ${parents.join(' + ')})` : '';
                gp.createGoal({
                    title: `Explore: ${insight.substring(0, 55)}`,
                    description: `${rationale || 'Newly synthesized concept'}${parentCtx}. Research and deepen understanding of this idea.`,
                    category: 'learning',
                    priority: 0.55,
                    autonomous: true
                }, 'thought_network_synthesis').catch(() => {}); // second arg = source for dedup/cooldown
            }
        });

        // self:kpi_update (RecursiveSelfModel) → trigger planning when CVI is declining
        system.messageBroker.subscribe('self:kpi_update', (signal) => {
            const { trend, cvi } = signal.payload || {};
            if (trend === 'declining' && cvi < 0.4 && system.goalPlanner?.runPlanningCycle) {
                system.goalPlanner.runPlanningCycle().catch(() => {});
            }
        });

        console.log('      ✅ COS Perception Layer ACTIVE (Watchdog + 8 Daemons + Swarm Intelligence)');

        return {
            attentionArbiter,
            daemonManager,
            engineeringSwarm,
            swarmOptimizer,
            discoverySwarm,
            curiosityReactor,
            proactivePerception,
            reflectionArbiter,
            knowledgeCurator,
            visionDaemon
        };

    } catch (err) {
        console.error('      ❌ COS Layer failed to initialize:', err.message);
        // Non-fatal error, system can continue with limited perception
        return {};
    }
}
