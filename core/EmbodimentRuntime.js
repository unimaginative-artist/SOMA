import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { LimbicCognitivePolicy } from './LimbicCognitivePolicy.js';

const MOTION_ACTIONS = new Set(['move', 'rotate', 'set_velocity', 'actuate']);
const SAFE_WHEN_DISARMED = new Set(['stop', 'emergency_stop', 'observe']);

/** Hardware-neutral boundary between cognition and a future robot body. */
export class EmbodimentRuntime extends EventEmitter {
    constructor({ simulation = true, receiptPath = 'SOMA/embodiment-receipts.jsonl', maxSensorAgeMs = 1000, limits = {} } = {}) {
        super();
        this.simulation = simulation;
        this.receiptPath = path.resolve(receiptPath);
        this.maxSensorAgeMs = maxSensorAgeMs;
        this.limits = {
            maxLinearMps: 0.25,
            maxAngularRps: 0.5,
            maxDurationMs: 2000,
            ...limits
        };
        this.sensors = new Map();
        this.actuators = new Map();
        this.armed = false;
        this.estopLatched = false;
        this.lastObservation = null;
        this.affectivePolicy = new LimbicCognitivePolicy();
        this._affectiveUnsubscribers = [];
        this._chargingRecommended = false;
    }

    connectAffectiveBroker(broker) {
        this.disconnectAffectiveBroker();
        if (!broker?.subscribe) return { connected: false, reason: 'broker_unavailable' };
        const receive = message => {
            const payload = message?.payload || message || {};
            const result = this.affectivePolicy.ingest({
                chemistry: payload.chemistry || payload.state || null,
                feelings: payload.feelings || null,
                source: payload.source || message?.from || 'limbic_broker',
                confidence: payload.confidence ?? 0.9,
                observedAt: payload.observedAt || message?.timestamp || Date.now(),
                reason: payload.reason || payload.weather || ''
            });
            if (!result.accepted) return;
            const policy = this.affectivePolicy.embodimentPolicy();
            if (policy.chargingRecommended && !this._chargingRecommended) {
                this.emit('charging_recommended', { at: Date.now(), affective: policy });
            }
            this._chargingRecommended = policy.chargingRecommended;
        };
        this._affectiveUnsubscribers.push(broker.subscribe('limbic_update', receive));
        this._affectiveUnsubscribers.push(broker.subscribe('embodiment.affect', receive));
        return { connected: true };
    }

    disconnectAffectiveBroker() {
        for (const unsubscribe of this._affectiveUnsubscribers || []) unsubscribe?.();
        this._affectiveUnsubscribers = [];
    }

    updateAffectiveState(input = {}) {
        return this.affectivePolicy.ingest(input);
    }

    registerSensor(name, adapter) {
        if (!name || typeof adapter?.read !== 'function') throw new Error('Sensor adapter must provide read()');
        this.sensors.set(name, adapter);
    }

    registerActuator(name, adapter) {
        if (!name || typeof adapter?.execute !== 'function') throw new Error('Actuator adapter must provide execute()');
        this.actuators.set(name, adapter);
    }

    arm({ operatorConfirmed = false } = {}) {
        if (!operatorConfirmed) return { armed: false, reason: 'operator_confirmation_required' };
        if (this.estopLatched) return { armed: false, reason: 'emergency_stop_latched' };
        this.armed = true;
        this.emit('armed');
        return { armed: true, simulation: this.simulation };
    }

    disarm(reason = 'operator') {
        this.armed = false;
        this.emit('disarmed', { reason });
        return { armed: false, reason };
    }

    async emergencyStop(reason = 'unspecified') {
        this.estopLatched = true;
        this.armed = false;
        const stops = await Promise.allSettled([...this.actuators.values()].map(adapter => adapter.stop?.()));
        const receipt = await this._receipt({ action: { type: 'emergency_stop' }, success: true, verified: true, reason, stops: stops.length });
        this.emit('emergency_stop', receipt);
        return receipt;
    }

    resetEmergencyStop({ operatorConfirmed = false } = {}) {
        if (!operatorConfirmed) return { reset: false, reason: 'operator_confirmation_required' };
        this.estopLatched = false;
        return { reset: true, armed: false };
    }

    async observe() {
        const observedAt = Date.now();
        const readings = {};
        for (const [name, adapter] of this.sensors) {
            try {
                const value = await adapter.read();
                readings[name] = { ok: true, value, timestamp: Number(value?.timestamp || observedAt) };
            } catch (error) {
                readings[name] = { ok: false, error: error.message, timestamp: observedAt };
            }
        }
        const stale = Object.entries(readings)
            .filter(([, reading]) => reading.ok && observedAt - reading.timestamp > this.maxSensorAgeMs)
            .map(([name]) => name);
        this.lastObservation = { observedAt, readings, stale, safeToMove: stale.length === 0 && Object.keys(readings).length > 0 };
        this.emit('observation', this.lastObservation);
        return this.lastObservation;
    }

    async execute(action = {}) {
        let normalized = this._validateAction(action);
        const affective = this.affectivePolicy.embodimentPolicy();
        if (normalized.type === 'emergency_stop') return this.emergencyStop(normalized.reason);
        if (normalized.type === 'stop') return this._stop(normalized);
        if (!this.armed && !SAFE_WHEN_DISARMED.has(normalized.type)) {
            return this._receipt({ action: normalized, success: false, verified: true, reason: 'embodiment_disarmed', affective });
        }
        if (this.estopLatched) return this._receipt({ action: normalized, success: false, verified: true, reason: 'emergency_stop_latched', affective });
        if (MOTION_ACTIONS.has(normalized.type) && affective.holdMotion) {
            return this._receipt({ action: normalized, success: false, verified: true, reason: 'affective_alarm_hold', affective });
        }

        if (MOTION_ACTIONS.has(normalized.type)) {
            normalized = {
                ...normalized,
                linearMps: Number((normalized.linearMps * affective.motionScale).toFixed(4)),
                angularRps: Number((normalized.angularRps * affective.motionScale).toFixed(4)),
                affectiveMotionScale: affective.motionScale
            };
        }

        const observation = await this.observe();
        if (MOTION_ACTIONS.has(normalized.type) && !observation.safeToMove) {
            return this._receipt({ action: normalized, success: false, verified: true, reason: 'fresh_sensor_state_required', observation, affective });
        }
        let confirmationObservation = null;
        if (MOTION_ACTIONS.has(normalized.type) && affective.requiresConfirmationObservation) {
            confirmationObservation = await this.observe();
            if (!confirmationObservation.safeToMove) {
                return this._receipt({ action: normalized, success: false, verified: true, reason: 'affective_uncertainty_requires_observation', observation, confirmationObservation, affective });
            }
        }

        if (this.simulation) {
            return this._receipt({ action: normalized, success: true, verified: true, simulated: true, observation, confirmationObservation, affective });
        }

        const adapter = this.actuators.get(normalized.actuator);
        if (!adapter) return this._receipt({ action: normalized, success: false, verified: true, reason: 'actuator_unavailable', affective });
        try {
            const result = await adapter.execute(normalized);
            const after = await this.observe();
            return this._receipt({ action: normalized, success: result?.success !== false, verified: Boolean(result?.verified), result, observation, confirmationObservation, after, affective });
        } catch (error) {
            await adapter.stop?.().catch?.(() => {});
            return this._receipt({ action: normalized, success: false, verified: true, reason: error.message, observation, confirmationObservation, affective });
        }
    }

    getStatus() {
        return {
            simulation: this.simulation,
            armed: this.armed,
            emergencyStop: this.estopLatched,
            sensors: [...this.sensors.keys()],
            actuators: [...this.actuators.keys()],
            limits: { ...this.limits },
            lastObservationAt: this.lastObservation?.observedAt || null,
            affective: this.affectivePolicy.embodimentPolicy()
        };
    }

    _validateAction(action) {
        const type = String(action.type || '').toLowerCase();
        if (!['move', 'rotate', 'set_velocity', 'actuate', 'stop', 'emergency_stop', 'observe'].includes(type)) throw new Error(`Unsupported embodiment action: ${type || 'missing'}`);
        return {
            ...action,
            type,
            linearMps: Math.max(-this.limits.maxLinearMps, Math.min(this.limits.maxLinearMps, Number(action.linearMps || 0))),
            angularRps: Math.max(-this.limits.maxAngularRps, Math.min(this.limits.maxAngularRps, Number(action.angularRps || 0))),
            durationMs: Math.max(0, Math.min(this.limits.maxDurationMs, Number(action.durationMs || 0)))
        };
    }

    async _stop(action) {
        const stops = await Promise.allSettled([...this.actuators.values()].map(adapter => adapter.stop?.()));
        return this._receipt({ action, success: true, verified: true, stops: stops.length });
    }

    async _receipt(data) {
        const receipt = { id: crypto.randomUUID(), at: new Date().toISOString(), simulation: this.simulation, ...data };
        await fs.mkdir(path.dirname(this.receiptPath), { recursive: true });
        await fs.appendFile(this.receiptPath, `${JSON.stringify(receipt)}\n`, 'utf8');
        this.emit('receipt', receipt);
        return receipt;
    }
}

export default EmbodimentRuntime;
