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
import RepoWatcherDaemon from '../../daemons/RepoWatcherDaemon.js';
import HealthDaemon from '../../daemons/HealthDaemon.js';
import OptimizationDaemon from '../../daemons/OptimizationDaemon.js';
import DiscoveryDaemon from '../../daemons/DiscoveryDaemon.js';
import MemoryPrunerDaemon from '../../daemons/MemoryPrunerDaemon.js';
import CuriosityDaemon from '../../daemons/CuriosityDaemon.js';
import SocialImpulseDaemon from '../../daemons/SocialImpulseDaemon.js';
import DaemonManager from '../../core/DaemonManager.js';

export async function loadCOSSystems(system) {
    console.log('\n[Loader] 🧠 Initializing Cognitive Operating System (COS) Layer...');

    try {
        // 1. Daemon Manager (The Supervisor with Watchdog)
        const daemonManager = new DaemonManager({ logger: console });
        system.daemonManager = daemonManager;

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
            rootPath: process.cwd()
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
            intervalMs: 43200000 
        }));

        // Daydream: Generate hypotheses every 2 hours
        daemonManager.register(new CuriosityDaemon({
            reactor: curiosityReactor,
            discovery: discoverySwarm,
            messageBroker: system.messageBroker,
            intervalMs: 7200000
        }));

        // Social: Proactively greet Barry when he's active
        const socialImpulse = new SocialImpulseDaemon({
            messageBroker: system.messageBroker,
            quadBrain: system.quadBrain,
            vision: system.visionArbiter || system.visionProcessing,
            intervalMs: 300000 // 5 minutes
        });
        daemonManager.register(socialImpulse);
        if (system.arbiters) system.arbiters.set('socialImpulse', socialImpulse);

        daemonManager.register(new OptimizationDaemon({
            optimizer: swarmOptimizer,
            intervalMs: 3600000 // hourly
        }));
        
        daemonManager.register(new DiscoveryDaemon({
            discovery: discoverySwarm,
            intervalMs: 86400000 // daily
        }));

        await daemonManager.startAll();

        // 8. Wire Signal Reactions (CNS Drivers)
        system.messageBroker.subscribe('swarm.optimization.needed', async (signal) => {
            console.log('[SOMA] 📊 Swarm optimization signal — running improvement cycle...');
            await swarmOptimizer.improve().catch(err =>
                console.warn('[SOMA] SwarmOptimizer.improve() failed:', err.message)
            );
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

        console.log('      ✅ COS Perception Layer ACTIVE (Watchdog + 7 Daemons + Swarm Intelligence)');

        return {
            attentionArbiter,
            daemonManager,
            engineeringSwarm,
            swarmOptimizer,
            discoverySwarm,
            curiosityReactor
        };

    } catch (err) {
        console.error('      ❌ COS Layer failed to initialize:', err.message);
        // Non-fatal error, system can continue with limited perception
        return {};
    }
}
