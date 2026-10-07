import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { BaseArbiter } = require('../core/BaseArbiter.cjs');
const messageBroker = require('../core/MessageBroker.cjs');
import fs from 'fs/promises';
import path from 'path';

/**
 * ArgusStreamArbiter — PROJECT ARGUS
 * v0.3 — Continuous Visual Perception with frame retrieval
 */
export class ArgusStreamArbiter extends BaseArbiter {
  static role = 'vision-stream';
  static capabilities = [
    'live-stream-capture',
    'motion-detection',
    'temporal-continuity',
    'visual-buffer-management'
  ];

  constructor(id, config = {}) {
    super(id, config);
    this.name = 'ArgusStreamArbiter';
    this.fps = config.fps || 1; // 1 FPS is much safer for CPU/GPU stability
    this.maxBufferSize = config.maxBufferSize || 30;
    this.motionThreshold = config.motionThreshold || 5000; // Filter out minor noise/flicker
    this.frameBuffer = [];
    this.isMonitoring = false;
    this.lastAnalyzedTimestamp = 0;
    this.neuralAnalysisCooldown = 10000; // 10s cooldown to prevent overheating
  }

  async onInitialize() {
    console.log('[Argus] 👁️ Initializing the All-Seeing Eye (OpenCV Reflex Active)...');

    messageBroker.subscribe('visual_frame_received', async (msg) => {
      this.handleFrame(msg.payload);
    });

    console.log('[Argus] ✅ Continuous Vision online.');
  }

  async handleFrame(payload) {
    const { frameData, timestamp, source = 'webcam' } = payload;
    const previousFrame = this.frameBuffer[this.frameBuffer.length - 1];

    this.frameBuffer.push({ frameData, timestamp });
    if (this.frameBuffer.length > this.maxBufferSize) {
      this.frameBuffer.shift();
    }

    const hasMotion = await this._detectMotion(frameData, previousFrame?.frameData);

    if (hasMotion && (timestamp - this.lastAnalyzedTimestamp > this.neuralAnalysisCooldown)) {
      this.lastAnalyzedTimestamp = timestamp;
      await this._performNeuralAnalysis(frameData, source);
    }
  }

  getLastImage() {
    if (this.frameBuffer.length === 0) return null;
    return this.frameBuffer[this.frameBuffer.length - 1].frameData;
  }

  async _detectMotion(currentBase64, previousBase64) {
    if (!previousBase64) return true;
    try {
      const diff = Math.abs(currentBase64.length - previousBase64.length);
      return diff > this.motionThreshold;
    } catch (e) {
      return true;
    }
  }

  async _performNeuralAnalysis(frameData, source) {
    console.log(`[Argus] 🔬 Motion Detected. Performing local neural focus...`);
    try {
      const analysis = await messageBroker.publish('vision_analysis_requested', {
        image: frameData,
        type: 'zero-shot'
      });

      if (analysis && analysis.objects?.length > 0) {
        const topObject = analysis.objects[0];
        console.log(`[Argus] 🎯 Recognition: ${topObject.label} (${(topObject.score * 100).toFixed(1)}%)`);

        if (topObject.score > 0.8) {
            await messageBroker.publish('vocal_synthesis_requested', {
                text: `I noticed a ${topObject.label} in the stream.`,
                emotion: 'excited'
            });
        }
      }
    } catch (err) {
      console.warn('[Argus] Neural analysis failed:', err.message);
    }
  }
}

export default ArgusStreamArbiter;
