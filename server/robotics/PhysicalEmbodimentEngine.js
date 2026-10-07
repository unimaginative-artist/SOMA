import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';

const ROBOTICS_STATE_PATH = path.join(process.cwd(), 'data', 'robotics_embodiment_state.json');

export class PhysicalEmbodimentEngine extends EventEmitter {
    constructor() {
        super();
        this.mode = 'virtual_simulation'; // 'virtual_simulation' | 'ros_bridge' | 'serial_hardware'

        this.robotState = {
            name: 'SOMA Physical Unit 1',
            status: 'online',
            batteryLevel: 98.5, // %
            powerState: 'charging',
            spatialLocation: { x: 0.0, y: 0.0, z: 0.0, yaw: 0.0 }, // meters / degrees
            jointPositions: {
                headPan: 0.0,   // degrees (-90 to +90)
                headTilt: 0.0,  // degrees (-45 to +45)
                armLeft: 0.0,
                armRight: 0.0,
                baseWheelLeft: 0.0,
                baseWheelRight: 0.0
            },
            sensorStreams: {
                webcamVisionActive: true,
                microphoneAudioActive: true,
                lidarDistanceMeters: 2.45,
                proximityWarning: false,
                trackedPerson: { name: 'Owner (Operator)', distanceMeters: 1.2, position: 'front_center' }
            },
            safetyGuard: {
                maxLinearVelocity: 0.5, // m/s
                maxAngularVelocity: 1.0, // rad/s
                emergencyStop: false,
                collisionDistanceThreshold: 0.3 // 30cm safety bubble
            }
        };

        this.loadState();
    }

    loadState() {
        try {
            if (fs.existsSync(ROBOTICS_STATE_PATH)) {
                const raw = fs.readFileSync(ROBOTICS_STATE_PATH, 'utf8');
                const data = JSON.parse(raw);
                if (data.robotState) this.robotState = { ...this.robotState, ...data.robotState };
                console.log(`[PhysicalEmbodimentEngine] 🤖 Loaded Robotics Embodiment State (${this.robotState.name}, Mode: ${this.mode}, Battery: ${this.robotState.batteryLevel}%)`);
            }
        } catch (e) {
            console.warn('[PhysicalEmbodimentEngine] State load note:', e.message);
        }
    }

    saveState() {
        try {
            fs.mkdirSync(path.dirname(ROBOTICS_STATE_PATH), { recursive: true });
            fs.writeFileSync(ROBOTICS_STATE_PATH, JSON.stringify({ mode: this.mode, robotState: this.robotState, updatedAt: Date.now() }, null, 2), 'utf8');
        } catch (e) {
            console.error('[PhysicalEmbodimentEngine] Save failed:', e.message);
        }
    }

    /**
     * Dispatch Bounded Physical Motor Movement (Head, Arm, Base)
     */
    executeMotorCommand(command = {}) {
        if (this.robotState.safetyGuard.emergencyStop) {
            throw new Error('MOTOR_BLOCKED: Emergency E-Stop is engaged!');
        }

        const { joint, angle, linearVelocity, angularVelocity } = command;

        if (joint && angle !== undefined) {
            // Joint angle limits check
            if (joint === 'headPan') this.robotState.jointPositions.headPan = Math.max(-90, Math.min(90, angle));
            if (joint === 'headTilt') this.robotState.jointPositions.headTilt = Math.max(-45, Math.min(45, angle));
            console.log(`[PhysicalEmbodimentEngine] 🦾 Motor Joint [${joint}] moved to ${angle}°`);
        }

        if (linearVelocity !== undefined || angularVelocity !== undefined) {
            const safeLinear = Math.max(-0.5, Math.min(0.5, linearVelocity || 0));
            const safeAngular = Math.max(-1.0, Math.min(1.0, angularVelocity || 0));
            
            this.robotState.spatialLocation.x += safeLinear * 0.1;
            console.log(`[PhysicalEmbodimentEngine] 🛞 Base Motors Driven: Linear ${safeLinear} m/s, Angular ${safeAngular} rad/s -> New X: ${this.robotState.spatialLocation.x.toFixed(2)}m`);
        }

        this.saveState();
        this.emit('robotics:motor_moved', this.robotState);
        return { success: true, robotState: this.robotState };
    }

    /**
     * Update Sensor Perception Stream (Vision, Person Tracking, LiDAR)
     */
    updateSensorPerception(sensorData = {}) {
        this.robotState.sensorStreams = { ...this.robotState.sensorStreams, ...sensorData };
        this.saveState();
        this.emit('robotics:sensor_updated', this.robotState.sensorStreams);
        return this.robotState.sensorStreams;
    }
}

export default new PhysicalEmbodimentEngine();
