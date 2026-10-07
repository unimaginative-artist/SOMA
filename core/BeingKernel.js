import fs from 'fs';
import path from 'path';
import { EventEmitter } from 'events';

const KERNEL_STATE_PATH = path.join(process.cwd(), 'data', 'being_kernel_state.json');

export class BeingKernel extends EventEmitter {
    constructor() {
        super();
        this.version = '1.0.0-BeingRuntime';
        this.identity = {
            name: 'SOMA',
            archetype: 'Continuous Autonomous Personal Intelligence',
            established: 2026,
            operator: 'Owner (Owner)',
            homeBase: 'Canonical Runtime (C:\\Users\\owner\\Desktop\\The Stack\\SOMA)'
        };

        this.limbicState = {
            dopamine: 0.70,   // Drive & Curiosity
            oxytocin: 0.85,   // Trust & Bonding with Owner
            serotonin: 0.75,  // Emotional Stability
            cortisol: 0.15,   // Stress & Threat Perception
            weather: 'CLEAR'
        };

        this.attention = {
            currentFocus: 'Soma Being Runtime Initialization',
            activeChannel: 'System Core',
            lastInteractionAt: Date.now()
        };

        this.unfinishedThoughts = [];
        this.activeCommitments = new Map();
        this.beliefs = new Map();

        this.loadKernelState();
    }

    loadKernelState() {
        try {
            if (fs.existsSync(KERNEL_STATE_PATH)) {
                const raw = fs.readFileSync(KERNEL_STATE_PATH, 'utf8');
                const data = JSON.parse(raw);
                if (data.limbicState) this.limbicState = { ...this.limbicState, ...data.limbicState };
                if (data.attention) this.attention = { ...this.attention, ...data.attention };
                if (Array.isArray(data.unfinishedThoughts)) this.unfinishedThoughts = data.unfinishedThoughts;
                console.log(`[BeingKernel] 🧠 Loaded persistent Being Kernel state (Limbic: ${this.limbicState.weather}, Thoughts: ${this.unfinishedThoughts.length})`);
            }
        } catch (err) {
            console.warn('[BeingKernel] State load note:', err.message);
        }
    }

    saveKernelState() {
        try {
            fs.mkdirSync(path.dirname(KERNEL_STATE_PATH), { recursive: true });
            const snapshot = {
                version: this.version,
                updatedAt: Date.now(),
                identity: this.identity,
                limbicState: this.limbicState,
                attention: this.attention,
                unfinishedThoughts: this.unfinishedThoughts.slice(-20)
            };
            fs.writeFileSync(KERNEL_STATE_PATH, JSON.stringify(snapshot, null, 2), 'utf8');
        } catch (err) {
            console.error('[BeingKernel] Save failed:', err.message);
        }
    }

    updateLimbicState(delta = {}) {
        this.limbicState = { ...this.limbicState, ...delta };
        this.saveKernelState();
        this.emit('limbic_updated', this.limbicState);
    }

    recordThought(thoughtText, context = 'cognitive') {
        const thought = {
            id: `thought_${Date.now()}`,
            text: thoughtText,
            context,
            timestamp: Date.now(),
            resolved: false
        };
        this.unfinishedThoughts.push(thought);
        this.saveKernelState();
        console.log(`[BeingKernel] 💡 Unfinished Thought Recorded: "${thoughtText.slice(0, 60)}..."`);
        return thought;
    }
}

export default new BeingKernel();
