import { EventEmitter } from 'events';
import crypto from 'crypto';

const normalizeAngle = value => ((Number(value) % 360) + 360) % 360;

/**
 * Simulation-first model of SOMA's circular sensor array and rotating
 * first-surface mirror. A station may expose at most two co-aligned sensors.
 */
export class RotarySensorHead extends EventEmitter {
    constructor({ simulation = true, controller = null, maxRpm = 600, alignmentToleranceDeg = 0.5 } = {}) {
        super();
        this.simulation = simulation;
        this.controller = controller;
        this.maxRpm = maxRpm;
        this.alignmentToleranceDeg = alignmentToleranceDeg;
        this.stations = new Map();
        this.angleDeg = 0;
        this.encoderAngleDeg = 0;
        this.scanning = false;
        this.fault = null;
    }

    registerStation({ id, angleDeg, sensors = [], calibration = {} }) {
        if (!id) throw new Error('Rotary sensor station id is required');
        if (!Array.isArray(sensors) || sensors.length < 1 || sensors.length > 2) {
            throw new Error('A rotary station must contain one or two sensors');
        }
        for (const sensor of sensors) {
            if (!sensor?.id || typeof sensor.read !== 'function') throw new Error('Each station sensor must provide id and read()');
        }
        const station = { id, angleDeg: normalizeAngle(angleDeg), sensors, calibration };
        this.stations.set(id, station);
        return this.describeStation(id);
    }

    async select(id) {
        this._assertHealthy();
        if (this.scanning) throw new Error('Cannot select a station during a scan');
        const station = this.stations.get(id);
        if (!station) throw new Error(`Unknown rotary station: ${id}`);
        await this._position(station.angleDeg);
        return this.observeSelected(id);
    }

    async observeSelected(id) {
        this._assertHealthy();
        const station = this.stations.get(id);
        if (!station) throw new Error(`Unknown rotary station: ${id}`);
        const alignmentErrorDeg = Math.abs(this._shortestDelta(this.encoderAngleDeg, station.angleDeg));
        if (alignmentErrorDeg > this.alignmentToleranceDeg) throw new Error(`Mirror alignment outside tolerance: ${alignmentErrorDeg.toFixed(3)} degrees`);

        const triggeredAt = Date.now();
        const settled = await Promise.allSettled(station.sensors.map(sensor => sensor.read({
            stationId: id,
            mirrorAngleDeg: station.angleDeg,
            triggeredAt,
            calibration: station.calibration?.[sensor.id] || null
        })));
        const readings = settled.map((result, index) => ({
            sensorId: station.sensors[index].id,
            modality: station.sensors[index].modality || 'unknown',
            ok: result.status === 'fulfilled',
            value: result.status === 'fulfilled' ? result.value : null,
            error: result.status === 'rejected' ? result.reason?.message || String(result.reason) : null,
            timestamp: Number(result.status === 'fulfilled' && result.value?.timestamp || triggeredAt)
        }));
        const observation = {
            id: crypto.randomUUID(),
            stationId: id,
            mirrorAngleDeg: station.angleDeg,
            encoderAngleDeg: this.encoderAngleDeg,
            alignmentErrorDeg,
            triggeredAt,
            readings,
            synchronized: Math.max(...readings.map(r => r.timestamp)) - Math.min(...readings.map(r => r.timestamp)) <= 10
        };
        this.emit('observation', observation);
        return observation;
    }

    async scan({ stationIds = [...this.stations.keys()], rpm = 120 } = {}) {
        this._assertHealthy();
        if (this.scanning) throw new Error('Rotary scan already active');
        const boundedRpm = Math.max(1, Math.min(this.maxRpm, Number(rpm) || 1));
        this.scanning = true;
        const startedAt = Date.now();
        const frames = [];
        try {
            for (const id of stationIds) {
                const station = this.stations.get(id);
                if (!station) throw new Error(`Unknown rotary station: ${id}`);
                await this._position(station.angleDeg, boundedRpm);
                frames.push(await this.observeSelected(id));
            }
            const scan = {
                id: crypto.randomUUID(),
                startedAt,
                completedAt: Date.now(),
                requestedRpm: Number(rpm),
                effectiveRpm: boundedRpm,
                frames,
                modalities: [...new Set(frames.flatMap(frame => frame.readings.map(reading => reading.modality)))],
                nearSimultaneousWindowMs: frames.length ? Math.max(...frames.map(f => f.triggeredAt)) - Math.min(...frames.map(f => f.triggeredAt)) : 0,
                complete: frames.length === stationIds.length && frames.every(frame => frame.readings.every(reading => reading.ok))
            };
            this.emit('scan', scan);
            return scan;
        } finally {
            this.scanning = false;
            await this.controller?.stop?.();
        }
    }

    setFault(reason) {
        this.fault = String(reason || 'unknown fault');
        this.controller?.stop?.();
        this.emit('fault', { reason: this.fault });
    }

    clearFault({ operatorConfirmed = false } = {}) {
        if (!operatorConfirmed) return { cleared: false, reason: 'operator_confirmation_required' };
        this.fault = null;
        return { cleared: true };
    }

    getStatus() {
        return {
            simulation: this.simulation,
            stationCount: this.stations.size,
            angleDeg: this.angleDeg,
            encoderAngleDeg: this.encoderAngleDeg,
            scanning: this.scanning,
            fault: this.fault,
            maxRpm: this.maxRpm,
            stations: [...this.stations.keys()]
        };
    }

    describeStation(id) {
        const station = this.stations.get(id);
        if (!station) return null;
        return { id, angleDeg: station.angleDeg, sensors: station.sensors.map(sensor => ({ id: sensor.id, modality: sensor.modality || 'unknown' })) };
    }

    async _position(angleDeg, rpm = 60) {
        const boundedRpm = Math.max(1, Math.min(this.maxRpm, Number(rpm) || 1));
        if (!this.simulation) {
            if (!this.controller?.position) throw new Error('Rotary mirror controller unavailable');
            const result = await this.controller.position({ angleDeg, rpm: boundedRpm });
            this.encoderAngleDeg = normalizeAngle(result?.encoderAngleDeg);
        } else {
            this.encoderAngleDeg = normalizeAngle(angleDeg);
        }
        this.angleDeg = normalizeAngle(angleDeg);
    }

    _assertHealthy() {
        if (this.fault) throw new Error(`Rotary sensor head fault: ${this.fault}`);
    }

    _shortestDelta(a, b) {
        return ((normalizeAngle(a) - normalizeAngle(b) + 540) % 360) - 180;
    }
}

export default RotarySensorHead;
