// ════════════════════════════════════════════════════════════════════════════
// VisionProcessingArbiter - Multi-modal Vision Intelligence
// ════════════════════════════════════════════════════════════════════════════
// Handles image analysis, object detection, scene understanding, and vision-based
// intent detection using Gemini Vision API
// ════════════════════════════════════════════════════════════════════════════

const { BaseArbiter } = require('../core/BaseArbiter.cjs');
const crypto = require('crypto');

class VisionProcessingArbiter extends BaseArbiter {
    constructor(config = {}) {
        super(config);

        this.config = {
            visionModel: config.visionModel || 'gemini-2.0-flash',
            visionApiKey: config.visionApiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY,
            maxImageSizeMB: config.maxImageSizeMB || 20,
            enableCaching: config.enableCaching !== false,
            cacheMaxSize: config.cacheMaxSize || 100,
            ...config
        };

        // Image analysis cache (hash → result)
        this.analysisCache = new Map();

        // Processing stats
        this.stats = {
            imagesProcessed: 0,
            cacheHits: 0,
            errorsEncountered: 0,
            totalProcessingTimeMs: 0,
            imagesByType: {}
        };

        // Supported image types
        this.supportedMimeTypes = [
            'image/png',
            'image/jpeg',
            'image/jpg',
            'image/webp',
            'image/heic',
            'image/heif'
        ];

        if (!this.config.visionApiKey) {
            console.warn('[VisionProcessingArbiter] ⚠️  No vision API key provided. Image analysis will fail.');
            console.warn('[VisionProcessingArbiter] Set GEMINI_API_KEY or GOOGLE_API_KEY env var or pass visionApiKey config');
        }

        console.log('[VisionProcessingArbiter] Initialized with config:', {
            model: this.config.visionModel,
            maxSize: `${this.config.maxImageSizeMB}MB`,
            caching: this.config.enableCaching,
            hasApiKey: !!this.config.visionApiKey
        });
    }

    async initialize() {
        await super.initialize();

        // Subscribe to vision-related events
        if (this.messageBroker) {
            await this.messageBroker.subscribe('image_received', this.handleImageReceived.bind(this));
            await this.messageBroker.subscribe('vision_analysis_requested', this.handleVisionAnalysisRequest.bind(this));
        }

        console.log('[VisionProcessingArbiter] ✅ Vision processing system active');
    }

    /**
     * Handle incoming images
     */
    async handleImageReceived(message) {
        const { imageData, mimeType, autoAnalyze, requestId } = message.payload;

        if (autoAnalyze) {
            try {
                const result = await this.analyzeImage(imageData, mimeType, {
                    prompt: 'Describe what you see in this image.'
                });

                // Emit analysis complete event
                await this.messageBroker.publish('vision_analyzed', {
                    requestId,
                    result,
                    timestamp: Date.now()
                });
            } catch (error) {
                console.error('[VisionProcessingArbiter] Auto-analysis failed:', error.message);
            }
        }
    }

    /**
     * Handle vision analysis requests
     */
    async handleVisionAnalysisRequest(message) {
        const { imageData, mimeType, prompt, options = {}, requestId } = message.payload;

        try {
            const result = await this.analyzeImage(imageData, mimeType, { prompt, ...options });

            // Emit response
            await this.messageBroker.publish('vision_analysis_response', {
                requestId,
                result,
                success: true,
                timestamp: Date.now()
            });
        } catch (error) {
            await this.messageBroker.publish('vision_analysis_response', {
                requestId,
                success: false,
                error: error.message,
                timestamp: Date.now()
            });
        }
    }

    /**
     * Analyze an image using Gemini Vision
     * @param {string} imageData - Base64 encoded image data
     * @param {string} mimeType - MIME type (image/png, image/jpeg, etc.)
     * @param {object} options - Analysis options
     * @returns {Promise<object>} Analysis result
     */
    async analyzeImage(imageData, mimeType, options = {}) {
        const startTime = Date.now();

        try {
            // Validate inputs
            this.validateImage(imageData, mimeType);

            // Check cache first
            if (this.config.enableCaching) {
                const cacheKey = this.getCacheKey(imageData, options.prompt);
                const cached = this.analysisCache.get(cacheKey);

                if (cached) {
                    this.stats.cacheHits++;
                    console.log('[VisionProcessingArbiter] 💾 Cache hit');
                    return cached;
                }
            }

            // Call Gemini Vision API
            const result = await this.callVisionAPI(imageData, mimeType, options);

            // Update stats
            this.stats.imagesProcessed++;
            this.stats.totalProcessingTimeMs += Date.now() - startTime;
            this.stats.imagesByType[mimeType] = (this.stats.imagesByType[mimeType] || 0) + 1;

            // Cache result
            if (this.config.enableCaching) {
                const cacheKey = this.getCacheKey(imageData, options.prompt);
                this.analysisCache.set(cacheKey, result);

                // Evict oldest if cache is full
                if (this.analysisCache.size > this.config.cacheMaxSize) {
                    const firstKey = this.analysisCache.keys().next().value;
                    this.analysisCache.delete(firstKey);
                }
            }

            // Emit vision event for other arbiters
            if (this.messageBroker) {
                await this.messageBroker.publish('vision_analyzed', {
                    description: result.description,
                    metadata: result.metadata,
                    timestamp: Date.now()
                });
            }

            return result;

        } catch (error) {
            this.stats.errorsEncountered++;
            console.error('[VisionProcessingArbiter] Analysis failed:', error.message);
            throw error;
        }
    }

    async callVisionAPI(imageData, mimeType, options = {}) {
        const ollamaEndpoint = process.env.OLLAMA_ENDPOINT || 'http://127.0.0.1:11434';
        const vlmModel = process.env.SOMA_LOCAL_VLM_MODEL || 'moondream:latest';
        const prompt = options.prompt || 'Describe what you see in this image in detail.';

        try {
            console.log(`[VisionProcessingArbiter] 🧠 Running local vision analysis using ${vlmModel}...`);
            const url = `${ollamaEndpoint}/api/generate`;
            
            // Ensure base64 string doesn't contain mime header
            const cleanBase64 = imageData.replace(/^data:image\/[a-z]+;base64,/, '');

            const requestBody = {
                model: vlmModel,
                prompt: prompt,
                images: [cleanBase64],
                stream: false
            };

            const controller = new AbortController();
            const timeoutMs = parseInt(process.env.SOMA_LOCAL_VLM_TIMEOUT_MS || '30000', 10);
            const timeout = setTimeout(() => controller.abort(), timeoutMs);

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody),
                signal: controller.signal
            });
            clearTimeout(timeout);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Local Ollama VLM returned status ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            const description = data.response || 'No description generated';

            return {
                success: true,
                description,
                metadata: {
                    model: vlmModel,
                    mimeType,
                    prompt
                },
                processingTimeMs: Date.now() - Date.now()
            };
        } catch (localErr) {
            console.warn(`[VisionProcessingArbiter] ⚠️  Local vision failed (${localErr.message}). Falling back to Gemini cloud...`);
            
            if (!this.config.visionApiKey || this.config.visionApiKey.includes('your-gemini-key')) {
                throw new Error(`Local vision failed (${localErr.message}) and no valid Gemini API key is configured in .env.`);
            }

            const model = options.model || this.config.visionModel;
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.config.visionApiKey}`;

            const requestBody = {
                contents: [{
                    parts: [
                        { text: prompt },
                        {
                            inline_data: {
                                mime_type: mimeType,
                                data: imageData.replace(/^data:image\/[a-z]+;base64,/, '')
                            }
                        }
                    ]
                }]
            };

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Vision API error (${response.status}): ${errorText}`);
            }

            const data = await response.json();
            const description = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No description generated';

            return {
                success: true,
                description,
                metadata: {
                    model,
                    mimeType,
                    prompt,
                    finishReason: data.candidates?.[0]?.finishReason,
                    safetyRatings: data.candidates?.[0]?.safetyRatings
                },
                processingTimeMs: Date.now() - Date.now()
            };
        }
    }

    /**
     * Validate image data
     */
    validateImage(imageData, mimeType) {
        if (!imageData || typeof imageData !== 'string') {
            throw new Error('Invalid image data: must be base64 string');
        }

        if (!this.supportedMimeTypes.includes(mimeType)) {
            throw new Error(`Unsupported image type: ${mimeType}. Supported: ${this.supportedMimeTypes.join(', ')}`);
        }

        // Check approximate size (base64 is ~1.37x original size)
        const sizeBytes = (imageData.length * 3) / 4;
        const sizeMB = sizeBytes / (1024 * 1024);

        if (sizeMB > this.config.maxImageSizeMB) {
            throw new Error(`Image too large: ${sizeMB.toFixed(2)}MB (max: ${this.config.maxImageSizeMB}MB)`);
        }

        return true;
    }

    /**
     * Generate cache key for image + prompt
     */
    getCacheKey(imageData, prompt = '') {
        const hash = crypto.createHash('md5');
        hash.update(imageData);
        hash.update(prompt);
        return hash.digest('hex');
    }

    /**
     * Detect objects in image
     */
    async detectObjects(imageData, mimeType) {
        return await this.analyzeImage(imageData, mimeType, {
            prompt: 'List all objects you can identify in this image. For each object, provide: name, location, confidence.'
        });
    }

    /**
     * Extract text from image (OCR)
     */
    async extractText(imageData, mimeType) {
        return await this.analyzeImage(imageData, mimeType, {
            prompt: 'Extract all visible text from this image. Preserve formatting and layout as much as possible.'
        });
    }

    /**
     * Analyze scene/context
     */
    async analyzeScene(imageData, mimeType) {
        return await this.analyzeImage(imageData, mimeType, {
            prompt: 'Describe the scene: setting, activity, mood, time of day, notable elements. Be concise but thorough.'
        });
    }

    /**
     * Compare two images
     */
    async compareImages(imageData1, imageData2, mimeType1, mimeType2) {
        // Analyze both images
        const analysis1 = await this.analyzeImage(imageData1, mimeType1, {
            prompt: 'Describe this image in detail focusing on key visual elements.'
        });

        const analysis2 = await this.analyzeImage(imageData2, mimeType2, {
            prompt: 'Describe this image in detail focusing on key visual elements.'
        });

        return {
            image1: analysis1.description,
            image2: analysis2.description,
            comparison: 'Images analyzed separately - implement comparison logic as needed'
        };
    }

    /**
     * Get processing statistics
     */
    getStats() {
        return {
            imagesProcessed: this.stats.imagesProcessed,
            cacheHits: this.stats.cacheHits,
            cacheSize: this.analysisCache.size,
            errorsEncountered: this.stats.errorsEncountered,
            averageProcessingTimeMs: this.stats.imagesProcessed > 0
                ? Math.round(this.stats.totalProcessingTimeMs / this.stats.imagesProcessed)
                : 0,
            imagesByType: this.stats.imagesByType,
            supportedFormats: this.supportedMimeTypes
        };
    }

    /**
     * Clear analysis cache
     */
    clearCache() {
        const size = this.analysisCache.size;
        this.analysisCache.clear();
        console.log(`[VisionProcessingArbiter] Cleared ${size} cached analyses`);
    }

    async shutdown() {
        console.log('[VisionProcessingArbiter] Shutting down...');
        this.clearCache();
        await super.shutdown();
    }
}

module.exports = VisionProcessingArbiter;
