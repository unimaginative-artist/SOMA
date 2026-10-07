/**
 * SensoryCortexArbiter.js
 * 
 * THE PERCEPTION LOBE (Governed by AURORA)
 * 
 * Unifies all multi-modal perception:
 * - VisionProcessingArbiter (CLIP / Image understanding)
 * - AudioProcessingArbiter (Whisper / Speech-to-text)
 * - EdgeWorkerOrchestrator (Real-time web browsing)
 * - CodeObservationArbiter (File-system proprioception)
 * 
 * PURPOSE: 
 * Translates raw signals into "SOMA Experience." 
 */

import { BaseArbiterV4, ArbiterRole, ArbiterCapability } from './BaseArbiter.js';

export class SensoryCortexArbiter extends BaseArbiterV4 {
    constructor(config = {}) {
        super({
            name: 'SensoryCortex',
            role: ArbiterRole.SENSORY_CORTEX,
            capabilities: [
                ArbiterCapability.VISUAL_PERCEPTION, 
                ArbiterCapability.AUDITORY_PROCESSING, 
                ArbiterCapability.WEB_BROWSING, 
                ArbiterCapability.CODE_AWARENESS
            ],
            ...config
        });

        // 1. Sensory Organs (The "Eyes & Ears")
        this.vision = config.vision || null;
        this.audio = config.audio || null;
        this.web = config.web || null;
        this.codeObserver = config.codeObserver || null;
    }

    async onInitialize() {
        this.log('info', '👁️  Initializing Sensory Cortex (Perception Lobe)...');
        
        // Ensure web-browsing link is hot
        if (this.web && !this.web.initialized) await this.web.initialize();
        
        this.log('info', '✅ Sensory streams unified under AURORA governance');
    }

    /**
     * Unified Sense: Combine modalities for a single query
     */
    async perceive(query, context = {}) {
        const perception = {
            visual: null,
            auditory: null,
            web: null,
            code: null
        };

        // Parallel perception
        const tasks = [];
        
        if (this.vision && context.hasImage) tasks.push(this.vision.analyze(context.image).then(r => perception.visual = r));
        if (this.web && context.needsWeb) tasks.push(this.web.search(query).then(r => perception.web = r));
        if (this.codeObserver && context.needsCode) tasks.push(this.codeObserver.scan().then(r => perception.code = r));

        await Promise.all(tasks);
        return perception;
    }

    getStatus() {
        return {
            vision: this.vision?.isHealthy() || false,
            audio: this.audio?.isHealthy() || false,
            web: this.web?.getStatus() || 'offline'
        };
    }
}
