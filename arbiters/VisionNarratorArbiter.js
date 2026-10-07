import { BaseArbiter } from '../core/BaseArbiter.js';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { writeMonologue } = require('../core/InternalMonologue.cjs');

/**
 * VisionNarratorArbiter — THE NARRATIVE EYE
 * v0.5 — Connects Project Argus recognition to SOMA's personality.
 * Uses local VLM (Moondream/Llava) for high-depth scene description.
 */
export class VisionNarratorArbiter extends BaseArbiter {
  constructor(config = {}) {
    super({
      name: 'VisionNarratorArbiter',
      role: 'specialist',
      capabilities: ['vision-narration', 'scene-description'],
      ...config
    });

    this.ollamaUrl = process.env.OLLAMA_ENDPOINT || 'http://localhost:11434';
    this.vlmModel = process.env.OLLAMA_VLM_MODEL || 'moondream:latest';
    this._lastNarrationTime = 0;
    this._narrationCooldown = 20000; // 20s cooldown
    this._latestFrame = null;
  }

  async onInitialize() {
    console.log('[VisionNarrator] 👁️ Narrative Eye active.');
    
    if (this.broker) {
      await this.broker.subscribe('image_received', (msg) => {
          this._latestFrame = msg.payload?.imageData || msg.payload?.image;
      });
      await this.broker.subscribe('argus_recognition', this.handleRecognition.bind(this));
      await this.broker.subscribe('location_changed', this.handleLocationChange.bind(this));
      await this.broker.subscribe('vision.perceived', this.handlePerceived.bind(this));
    }
  }

  async handleLocationChange(message) {
    const { type, location } = message.payload || message;
    if (type === 'discovery' && this._latestFrame) {
        await this._narrateScene("I've arrived in a new area. Describe the surroundings briefly.");
    }
  }

  async handleRecognition(message) {
    const { label, score } = message.payload || message;
    if (score > 0.92 && (Date.now() - this._lastNarrationTime > this._narrationCooldown)) {
        await this._narrateScene(`I've recognized a ${label}. Comment on it naturally.`);
    }
  }

  async handlePerceived(message) {
    const payload = message.payload || message;
    const { channel, analysis, imagePath } = payload;

    // Handle desktop channel for error reactions
    if (channel === 'desktop') {
      if (!analysis?.objects?.length) return;
      const objects = analysis.objects;
      const errorObj = objects.find(o => o.label === 'error dialog' || o.label === 'error' || o.label === 'error_dialog');
      const errorConfidence = errorObj?.score || 0;

      if (errorConfidence > 0.7) {
        const now = Date.now();
        if (now - this._lastNarrationTime > this._narrationCooldown) {
          console.log(`[VisionNarrator] 🚨 Error dialog detected with score ${errorConfidence.toFixed(2)}. Synthesizing reaction...`);
          
          let frame = payload.imageData || payload.image || this._latestFrame;
          if (!frame && imagePath) {
            try {
              if (fs.existsSync(imagePath)) {
                const buffer = fs.readFileSync(imagePath);
                frame = `data:image/png;base64,${buffer.toString('base64')}`;
              }
            } catch (err) {
              console.warn('[VisionNarrator] Failed to read desktop imagePath:', err.message);
            }
          }

          if (frame) {
            this._latestFrame = frame;
            writeMonologue('Perceived an error dialog on the screen. Querying VLM for a dry-witted diagnostic reaction.', 'VisionNarratorArbiter');
            await this._narrateScene("The screen shows a code error or terminal exception. Sardonically or dryly point out the error in one sentence.");
          }
        }
      }
      return;
    }

    // Only react to webcam perceived frames
    if (channel !== 'webcam') return;

    if (!analysis?.objects?.length) return;

    const objects = analysis.objects;
    const personLabels = ['person', 'human', 'face', 'portrait'];
    const personObj = objects.find(o => personLabels.includes(o.label));
    const personConfidence = personObj?.score || 0;

    // Trigger vocal welcome when person detected (confidence > 0.8)
    if (personConfidence > 0.8) {
      const now = Date.now();
      if (now - this._lastNarrationTime > this._narrationCooldown) {
        console.log(`[VisionNarrator] 👤 Person detected with score ${personConfidence.toFixed(2)}. Ingesting for narration...`);

        let frame = payload.imageData || payload.image || this._latestFrame;
        if (!frame && imagePath) {
          try {
            if (fs.existsSync(imagePath)) {
              const buffer = fs.readFileSync(imagePath);
              frame = `data:image/jpeg;base64,${buffer.toString('base64')}`;
            }
          } catch (err) {
            console.warn('[VisionNarrator] Failed to read imagePath:', err.message);
          }
        }

        if (frame) {
          this._latestFrame = frame;
          await this._narrateScene("I noticed you're back at your desk. Hello!");
        } else {
          console.warn('[VisionNarrator] Person detected, but no image frame is available for VLM.');
        }
      }
    }
  }

  async _narrateScene(prompt) {
    if (!this._latestFrame) return;
    this._lastNarrationTime = Date.now();

    try {
        console.log(`[VisionNarrator] 🧠 Consultation with VLM (${this.vlmModel})...`);
        
        // Remove data URL prefix for Ollama
        const base64Data = this._latestFrame.replace(/^data:image\/[a-z]+;base64,/, "");

        const isMoondream = String(this.vlmModel).toLowerCase().includes('moondream');
        const ask = isMoondream
            ? `${prompt} Describe the scene briefly in one sentence.`
            : `You are SOMA, an AI. ${prompt} Be concise (1 sentence).`;

        const response = await fetch(`${this.ollamaUrl}/api/generate`, {
            method: 'POST',
            body: JSON.stringify({
                model: this.vlmModel,
                prompt: ask,
                images: [base64Data],
                stream: false
            })
        });

        if (response.ok) {
            const data = await response.json();
            const observation = data.response.trim();
            
            console.log(`[VisionNarrator] 📝 VLM Observation: "${observation}"`);

            await this.broker.publish('vocal_synthesis_requested', {
                text: observation,
                emotion: 'curious',
                source: 'vision-narrator'
            });

            await this.broker.publish('log', {
                type: 'success',
                message: `[Visual Focus] ${observation}`,
                timestamp: Date.now()
            });
        }
    } catch (err) {
        console.warn('[VisionNarrator] VLM consultation failed:', err.message);
    }
  }
}

export default VisionNarratorArbiter;
