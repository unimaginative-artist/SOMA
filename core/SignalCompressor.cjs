/**
 * core/SignalCompressor.cjs
 * 
 * Impulse Compression Layer for SOMA Cognitive Operating System.
 * Reduces noise by merging rapid, duplicate, or related signals.
 */

class SignalCompressor {
    constructor(config = {}) {
        this.windowMs = config.windowMs || 1000; // 1 second window for temporal merging
        this.buffers = new Map(); // type -> signal[]
        this.timers = new Map();
        this.onCompressed = config.onCompressed || (() => {});
    }

    /**
     * Process an incoming signal
     * Returns true if the signal was buffered/swallowed, false if it should be delivered immediately.
     */
    process(signal) {
        const { type, priority } = signal;

        // High priority signals (CRITICAL, EMERGENCY) bypass compression
        if (priority === 'high' || priority === 'emergency') {
            return false;
        }

        // Initialize buffer for this type
        if (!this.buffers.has(type)) {
            this.buffers.set(type, []);
        }

        const buffer = this.buffers.get(type);
        buffer.push(signal);

        // Reset/Start the window timer
        if (this.timers.has(type)) {
            clearTimeout(this.timers.get(type));
        }

        const timer = setTimeout(() => {
            this._flush(type);
        }, this.windowMs);
        if (typeof timer.unref === 'function') timer.unref();

        this.timers.set(type, timer);

        return true; // Signal is buffered
    }

    /**
     * Merge buffered signals and emit the compressed result
     */
    _flush(type) {
        const buffer = this.buffers.get(type);
        if (!buffer || buffer.length === 0) return;

        this.buffers.set(type, []); // Clear buffer
        this.timers.delete(type);

        if (buffer.length === 1) {
            this.onCompressed(buffer[0]);
            return;
        }

        // --- COMPRESSION LOGIC ---
        
        const first = buffer[0];
        let compressed = {
            ...first,
            timestamp: Date.now(),
            metadata: {
                ...first.metadata,
                compressed: true,
                originalCount: buffer.length
            }
        };

        // Semantic Aggregation based on type
        switch (type) {
            case 'repo.file.changed':
            case 'repo.file.added':
                compressed.type = 'repo.batch.change';
                compressed.payload = {
                    files: [...new Set(buffer.map(s => s.payload.path || s.payload.file))],
                    actions: [...new Set(buffer.map(s => s.type))]
                };
                break;

            case 'diagnostic.anomaly':
                compressed.payload = {
                    anomalies: buffer.map(s => s.payload),
                    count: buffer.length,
                    severity: Math.max(...buffer.map(s => s.payload.severity || 0))
                };
                break;

            default:
                // Generic Duplicate Suppression
                compressed.payload = {
                    batch: buffer.map(s => s.payload),
                    count: buffer.length
                };
        }

        this.onCompressed(compressed);
    }
}

module.exports = SignalCompressor;
