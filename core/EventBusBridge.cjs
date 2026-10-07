/**
 * core/EventBusBridge.cjs
 *
 * Neural Event Bus Bridge for SOMA
 * 
 * Bridges previously dead-ended MessageBroker topics into real, active
 * cognitive and operational loops, and provides bidirectional bridging
 * between MessageBroker pub/sub and arbiter EventEmitters.
 */

const EventEmitter = require('events');

class EventBusBridge {
    constructor(opts = {}) {
        this.messageBroker = opts.messageBroker || null;
        this.system = opts.system || null;
        this.logger = opts.logger || console;
        this.subscriptions = [];
        this.bridgedEmitters = new Map();
        this.stats = {
            bridgedEventsDelivered: 0,
            opportunitiesRouted: 0,
            curiosityImpulsesRouted: 0,
            securityPatchesRouted: 0,
            canaryFailuresRouted: 0
        };
        this.initialized = false;
    }

    initialize({ messageBroker, system } = {}) {
        if (messageBroker) this.messageBroker = messageBroker;
        if (system) this.system = system;

        if (!this.messageBroker) {
            this.logger.warn('[EventBusBridge] ⚠️ No MessageBroker provided; bridge dormant.');
            return this;
        }

        this._wireOrphanChannels();
        this.initialized = true;
        this.logger.log('    ⚡ [EventBusBridge] Neural wiring active — orphan event void bridged.');
        return this;
    }

    _wireOrphanChannels() {
        const mb = this.messageBroker;

        // 1. self_modification.opportunity -> SelfModificationPipeline & GoalPlanner
        const unsubSelfMod = mb.subscribe('self_modification.opportunity', async (payload) => {
            this.stats.opportunitiesRouted++;
            this.logger.log(`    🧠 [EventBusBridge] Intercepted self_modification.opportunity: "${payload?.title || 'Unknown'}"`);
            
            const pipeline = this.system?.selfModPipeline || this.system?.selfModificationArbiter;
            const planner = this.system?.goalPlanner || this.system?.goalPlannerArbiter;

            if (pipeline && typeof pipeline.proposeChange === 'function') {
                try {
                    await pipeline.proposeChange({
                        source: payload.source || 'CrossDomainSynthesis',
                        title: payload.title,
                        description: payload.description,
                        confidence: payload.confidence || 0.7,
                        evidence: payload.evidence,
                        category: 'self_improvement'
                    });
                } catch (err) {
                    this.logger.warn(`    ⚠️ [EventBusBridge] Pipeline failed to accept opportunity: ${err.message}`);
                }
            } else if (planner && typeof planner.createGoal === 'function') {
                try {
                    await planner.createGoal({
                        title: payload.title,
                        description: payload.description,
                        category: 'self_improvement',
                        priority: 60
                    });
                } catch (err) {
                    this.logger.warn(`    ⚠️ [EventBusBridge] GoalPlanner failed to accept opportunity: ${err.message}`);
                }
            }
        });
        this.subscriptions.push(unsubSelfMod);

        // 2. curiosity:stimulate -> CuriosityMind / CuriosityEngine
        const unsubCuriosity = mb.subscribe('curiosity:stimulate', async (payload) => {
            this.stats.curiosityImpulsesRouted++;
            const target = this.system?.curiosityMind || globalThis.__somaCuriosityMind || this.system?.curiosityEngine;
            if (target) {
                if (typeof target.stimulate === 'function') {
                    target.stimulate(payload);
                } else if (typeof target.handleImpulse === 'function') {
                    target.handleImpulse(payload);
                } else if (typeof target.emit === 'function') {
                    target.emit('curiosity:stimulate', payload);
                }
            }
        });
        this.subscriptions.push(unsubCuriosity);

        // 3. security.logic_update -> ImmuneSystem & SelfModificationPipeline
        const unsubSecurity = mb.subscribe('security.logic_update', async (payload) => {
            this.stats.securityPatchesRouted++;
            this.logger.log(`    🛡️ [EventBusBridge] Intercepted security.logic_update from Red Team`);

            const immune = this.system?.immuneSystem || this.system?.immuneSystemArbiter;
            if (immune) {
                if (typeof immune.recordThreatDefense === 'function') {
                    immune.recordThreatDefense(payload);
                } else if (typeof immune.emit === 'function') {
                    immune.emit('security.logic_update', payload);
                }
            }

            // If a concrete patch was proposed, route to SelfModificationPipeline
            const pipeline = this.system?.selfModPipeline;
            if (pipeline && payload?.defense_patch && typeof pipeline.proposeChange === 'function') {
                try {
                    await pipeline.proposeChange({
                        source: 'AdversarialSelfCorrectionArbiter',
                        title: `Security Patch: ${payload.cve_inspiration || 'Vulnerability Mitigation'}`,
                        description: `Attack: ${payload.attack_vector}\nDefense: ${payload.defense_patch}`,
                        category: 'security_hardening',
                        confidence: 0.85
                    });
                } catch (err) {
                    this.logger.warn(`    ⚠️ [EventBusBridge] Failed routing security patch to pipeline: ${err.message}`);
                }
            }
        });
        this.subscriptions.push(unsubSecurity);

        // 4. cybersec_challenge_generation -> AdversarialSelfCorrectionArbiter
        const unsubCybersec = mb.subscribe('cybersec_challenge_generation', async (challenge) => {
            const redTeam = this.system?.adversarialSelfCorrection || this.system?.redTeamArbiter;
            if (redTeam && typeof redTeam.runRedTeamSession === 'function') {
                await redTeam.runRedTeamSession(challenge);
            }
        });
        this.subscriptions.push(unsubCybersec);

        // 5. goal.canary.failed -> ImmuneSystem & Diagnostic
        const unsubCanary = mb.subscribe('goal.canary.failed', (payload) => {
            this.stats.canaryFailuresRouted++;
            this.logger.warn(`    🚨 [EventBusBridge] Goal canary failed: ${payload?.goalId || 'Unknown'} - ${payload?.reason || ''}`);
            const immune = this.system?.immuneSystem;
            if (immune && typeof immune.reportFault === 'function') {
                immune.reportFault('goal.canary.failed', payload);
            }
        });
        this.subscriptions.push(unsubCanary);
    }

    /**
     * Bridge an arbitrary EventEmitter to the MessageBroker bidirectionally
     * @param {EventEmitter} emitter
     * @param {string} channelPrefix
     * @param {string[]} topics
     */
    bridgeEventEmitter(emitter, channelPrefix = '', topics = []) {
        if (!emitter || typeof emitter.on !== 'function') return;

        const bridgedObjects = new WeakSet();

        for (const topic of topics) {
            const brokerTopic = channelPrefix ? `${channelPrefix}.${topic}` : topic;

            // Emitter -> MessageBroker
            const onEmitter = (data) => {
                if (typeof data === 'object' && data !== null) {
                    if (bridgedObjects.has(data)) return; // prevent echo
                    bridgedObjects.add(data);
                }
                this.stats.bridgedEventsDelivered++;
                this.messageBroker.publish(brokerTopic, data).catch(() => {});
            };
            emitter.on(topic, onEmitter);

            // MessageBroker -> Emitter
            const unsubBroker = this.messageBroker.subscribe(brokerTopic, (data) => {
                if (typeof data === 'object' && data !== null) {
                    if (bridgedObjects.has(data)) return; // prevent echo
                    bridgedObjects.add(data);
                }
                this.stats.bridgedEventsDelivered++;
                emitter.emit(topic, data);
            });

            this.subscriptions.push(unsubBroker);
        }
    }

    teardown() {
        for (const unsub of this.subscriptions) {
            if (typeof unsub === 'function') unsub();
        }
        this.subscriptions = [];
        this.initialized = false;
    }
}

module.exports = EventBusBridge;
