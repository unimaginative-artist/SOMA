/**
 * daemons/VisionDaemon.js
 *
 * SOMA Perception Layer: Vision Watchdog
 * Provides persistent "Computer Use" perception by capturing the desktop/webcam 
 * frames at a steady interval, analyzing them with CLIP (VisionProcessingArbiter),
 * and emitting 'vision.perceived' signals.
 *
 * Features:
 * - Delta Hashing: Only runs expensive CLIP analysis when the screen content changes.
 * - Multi-Channel: Can switch between Desktop and Webcam perception.
 * - Persistence: Independent of UI tab state — SOMA is always looking if active.
 * - Adaptive Polling: Adjusts frequency based on user/system activity.
 * - Hand-Eye Verification: Checks visual state after computer actions to ensure intent succeeded.
 */

import BaseDaemon from './BaseDaemon.js';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { recordLoopEvent } from '../server/utils/LoopLedger.js';

export class VisionDaemon extends BaseDaemon {
    constructor(opts = {}) {
        super({
            name: 'VisionDaemon',
            interval: opts.intervalMs || 10000, // Start in idle mode 10s
            ...opts
        });

        // Dependencies
        this.computerControl = opts.computerControl || null;
        this.visionProcessing = opts.visionProcessing || null;
        this.objectMemory = opts.objectMemory || null;
        
        // State
        this.channel = opts.channel || 'desktop'; // 'desktop' | 'webcam'
        this.lastHash = null;
        this.lastPerception = null;
        this.perceptionCount = 0;
        this.ghostCursor = null; // { x, y, action, timestamp }
        // Desktop vision is attention-driven. Starting this at "now" made every
        // boot spend its first 30 seconds classifying an idle desktop with CLIP.
        this.lastActionMs = 0;
        this.isExecutingGoal = false;
        this.lastIngestedFramePath = null;
        this.lastIngestedFrameTime = 0;
        this.actionFailureCounts = new Map();
        
        // Metrics
        this.metrics = {
            framesCaptured: 0,
            analysisCount: 0,
            deltasDetected: 0,
            lastAnalysisMs: 0
        };

        this.logger.info(`[VisionDaemon] 👁️  Initialized. Mode: ${this.channel}`);

        // Subscribe to computer actions for ghost cursor, adaptive polling, and verification
        if (opts.messageBroker) {
            opts.messageBroker.subscribe('computer.action', (signal) => {
                const { action, x, y } = signal.payload || {};
                this.lastActionMs = Date.now();
                if (x !== undefined && y !== undefined) {
                    this.ghostCursor = { x, y, action, timestamp: this.lastActionMs };
                }
                
                // Trigger Hand-Eye Verification for active interactions
                if (action === 'click' || action === 'type' || action === 'doubleClick' || action === 'rightClick') {
                    this._verifyAction(signal.payload).catch(e => this.logger.error(`[VisionDaemon] Verification failed: ${e.message}`));
                }
            });

            opts.messageBroker.subscribe('goal.execution.started', () => {
                this.isExecutingGoal = true;
            });

            opts.messageBroker.subscribe('goal.execution.completed', () => {
                this.isExecutingGoal = false;
                this.lastActionMs = Date.now();
            });
            
            opts.messageBroker.subscribe('goal.execution.failed', () => {
                this.isExecutingGoal = false;
                this.lastActionMs = Date.now();
            });

            opts.messageBroker.subscribe('vision.channel_requested', (signal) => {
                const { channel } = signal.payload || {};
                if (channel && ['desktop', 'webcam'].includes(channel)) {
                    this.setChannel(channel);
                }
            });

            opts.messageBroker.subscribe('vision.frame_ingested', (signal) => {
                const { imagePath, timestamp } = signal.payload || {};
                if (imagePath) {
                    this.lastIngestedFramePath = imagePath;
                    this.lastIngestedFrameTime = timestamp || Date.now();
                    this.logger.info(`[VisionDaemon] Received frame_ingested signal for path: ${imagePath}`);
                }
            });
        }
    }

    setProviders(computerControl, visionProcessing) {
        this.computerControl = computerControl;
        this.visionProcessing = visionProcessing;
    }

    setChannel(channel) {
        if (channel === this.channel) return;
        this.channel = channel;
        this.lastHash = null; 
        this.logger.info(`[VisionDaemon] Switched channel to: ${channel}`);
    }

    async tick() {
        if (!this.computerControl) return;

        // Adaptive Polling Logic
        const timeSinceAction = Date.now() - this.lastActionMs;
        const hasRecentIngestedFrame = this.channel === 'webcam' && this.lastIngestedFramePath && (Date.now() - this.lastIngestedFrameTime < 10000);

        if (hasRecentIngestedFrame) {
            this.interval = 1000; // ACTIVE browser webcam stream mode
        } else if (timeSinceAction < 30000) {
            this.interval = 3000; // ACTIVE mode
        } else if (this.isExecutingGoal) {
            this.interval = 10000; // Observe cheaply; actions trigger active mode
        } else {
            this.interval = 30000; // IDLE mode
        }

        try {
            // 1. Capture Frame
            let capture;
            if (this.channel === 'webcam') {
                const now = Date.now();
                if (this.lastIngestedFramePath && (now - this.lastIngestedFrameTime < 12000)) {
                    capture = await this.computerControl.captureWebcam({ inputPath: this.lastIngestedFramePath });
                } else {
                    capture = await this.computerControl.captureWebcam({ format: 'jpg' });
                }
            } else {
                capture = await this.computerControl.captureScreen({ format: 'png' });
            }
            if (!capture.success) {
                this.logger.warn(`[VisionDaemon] Capture failed: ${capture.error}`);
                return;
            }

            this.metrics.framesCaptured++;
            const imagePath = capture.imagePath;

            // 2. Hash to detect visual delta
            const hash = await this._hashImage(imagePath);
            if (hash === this.lastHash) {
                return; // No change
            }

            this.metrics.deltasDetected++;
            this.lastHash = hash;

            // 3. Process with Brain (CLIP) or skip for webcam
            let analysis = null;
            const t0 = Date.now();

            const continuousDesktopVision = process.env.SOMA_CONTINUOUS_DESKTOP_VISION === 'true';
            const desktopAttentionActive = continuousDesktopVision || timeSinceAction < 30000;
            const shouldProcess = this.channel === 'webcam' || (Boolean(this.visionProcessing) && desktopAttentionActive);

            if (shouldProcess) {
                if (this.channel === 'webcam') {
                    // Skip expensive CLIP classification for webcam stream since OpenCV 5 handles face/eye detection actively
                    analysis = { success: true, objects: [], ocrText: null };
                } else {
                    analysis = await this.visionProcessing.detectObjects(imagePath);
                }
                
                if (analysis.success) {
                    // Merge OpenCV 5 face/eye detections into analysis.objects
                    if (!analysis.objects) analysis.objects = [];
                    if (capture.opencv) {
                        const opencvObjects = [];
                        if (capture.opencv.faces && Array.isArray(capture.opencv.faces)) {
                            for (const face of capture.opencv.faces) {
                                opencvObjects.push({
                                    label: 'person',
                                    score: 0.95,
                                    bbox: face.bbox
                                });
                            }
                        }
                        if (capture.opencv.eyes && Array.isArray(capture.opencv.eyes)) {
                            for (const eye of capture.opencv.eyes) {
                                opencvObjects.push({
                                    label: 'eye',
                                    score: 0.90,
                                    bbox: eye.bbox
                                });
                            }
                        }
                        // Remove generic 'webcam frame' labels if we have concrete detections
                        if (opencvObjects.length > 0) {
                            analysis.objects = analysis.objects.filter(obj => obj.label !== 'webcam frame');
                        }
                        analysis.objects.push(...opencvObjects);
                    }

                    this.metrics.analysisCount++;
                    this.metrics.lastAnalysisMs = Date.now() - t0;
                    // Include imagePath in lastPerception so perceptionRoutes /vision/last exposes it
                    const perceivedAt = Date.now();
                    if (this.objectMemory) {
                        analysis.objects = this.objectMemory.ingest({ objects: analysis.objects, timestamp: perceivedAt, channel: this.channel, imagePath });
                    }
                    this.lastPerception = { ...analysis, imagePath, channel: this.channel, timestamp: perceivedAt };
                    this.perceptionCount++;

                    // 4. Emit Perception Signal
                    this.emitSignal('vision.perceived', {
                        channel: this.channel,
                        imagePath,
                        analysis,
                        ghostCursor: this.ghostCursor,
                        count: this.perceptionCount,
                        timestamp: Date.now()
                    }, 'normal');

                    this.logger.info(`[VisionDaemon] 🧠 Perceived: ${analysis.objects[0]?.label || 'Nothing specific'} (${this.metrics.lastAnalysisMs}ms)`);
                }
            } else {
                this.emitSignal('vision.delta', {
                    channel: this.channel,
                    imagePath,
                    timestamp: Date.now()
                }, 'low');
            }

        } catch (err) {
            this.logger.error(`[VisionDaemon] Error during tick: ${err.message}`);
        }
    }

    /**
     * Hand-Eye Verification: Confirmation Pulse
     * Validates that a physical action resulted in a visual change.
     */
    async _verifyAction(actionPayload) {
        if (!this.computerControl) return;

        // 1. Check at T+250ms: Did anything change?
        await this.sleep(250);
        let capture = await this.computerControl.captureScreen({ format: 'png' });
        if (!capture.success) return;
        
        let hash250 = await this._hashImage(capture.imagePath);
        const changedAt250 = (hash250 !== this.lastHash);

        // 2. Check at T+800ms: Did it stabilize?
        await this.sleep(550); // Total 800ms
        capture = await this.computerControl.captureScreen({ format: 'png' });
        if (!capture.success) return;

        let hash800 = await this._hashImage(capture.imagePath);
        const changedAt800 = (hash800 !== this.lastHash);

        // Update baseline hash to prevent duplicate tick() processing
        this.lastHash = hash800;

        if (!changedAt250 && !changedAt800) {
            this.logger.warn(`[VisionDaemon] ⚠️ Hand-Eye Verification FAILED: Screen identical after ${actionPayload.action}.`);
            await this._recordActionVerification({
                actionPayload,
                verified: false,
                reason: 'No visual change detected after 800ms',
                imagePath: capture.imagePath
            });
            this.emitSignal('vision.action.unverified', {
                action: actionPayload,
                reason: 'No visual change detected after 800ms',
                timestamp: Date.now()
            }, 'high');
            return;
        }

        // It changed, run semantic check if possible
        if (this.visionProcessing) {
            const t0 = Date.now();
            const analysis = await this.visionProcessing.detectObjects(capture.imagePath);
            
            if (analysis.success) {
                this.metrics.analysisCount++;
                this.metrics.lastAnalysisMs = Date.now() - t0;
                this.lastPerception = { ...analysis, imagePath: capture.imagePath, channel: this.channel, timestamp: Date.now() };
                this.perceptionCount++;

                this.emitSignal('vision.action.verified', {
                    action: actionPayload,
                    analysis,
                    timestamp: Date.now()
                }, 'normal');
                await this._recordActionVerification({
                    actionPayload,
                    verified: true,
                    reason: 'Visual delta detected and semantic analysis succeeded',
                    imagePath: capture.imagePath,
                    analysis
                });

                this.emitSignal('vision.perceived', {
                    channel: this.channel,
                    imagePath: capture.imagePath,
                    analysis,
                    ghostCursor: this.ghostCursor,
                    count: this.perceptionCount,
                    timestamp: Date.now()
                }, 'normal');
                
                this.logger.info(`[VisionDaemon] ✅ Action Verified: ${analysis.objects[0]?.label || 'Screen changed'}`);
            }
        } else {
            await this._recordActionVerification({
                actionPayload,
                verified: true,
                reason: 'Visual delta detected',
                imagePath: capture.imagePath
            });
            this.emitSignal('vision.action.verified', {
                action: actionPayload,
                reason: 'Visual delta detected',
                timestamp: Date.now()
            }, 'normal');
        }
    }

    _actionKey(actionPayload = {}) {
        return [
            actionPayload.action || actionPayload.type || 'action',
            actionPayload.x !== undefined ? Math.round(Number(actionPayload.x) / 50) * 50 : '',
            actionPayload.y !== undefined ? Math.round(Number(actionPayload.y) / 50) * 50 : ''
        ].filter(value => value !== '').join(':');
    }

    async _recordActionVerification({ actionPayload = {}, verified = false, reason = '', imagePath = null, analysis = null } = {}) {
        const key = this._actionKey(actionPayload);
        if (verified) this.actionFailureCounts.delete(key);
        else this.actionFailureCounts.set(key, (this.actionFailureCounts.get(key) || 0) + 1);

        await recordLoopEvent({
            loop: 'vision_action_verification',
            phase: verified ? 'daemon_verified' : 'daemon_unverified',
            actor: 'VisionDaemon',
            target: actionPayload.action || actionPayload.type || 'action',
            channel: this.channel,
            claim: verified
                ? `Computer action ${actionPayload.action || actionPayload.type || 'action'} caused a visual state change`
                : `Computer action ${actionPayload.action || actionPayload.type || 'action'} did not cause a detectable visual state change`,
            falsificationTest: 'Compare pre-action baseline hash to post-action screenshots at 250ms and 800ms',
            testResult: Boolean(verified),
            evidence: {
                action: actionPayload,
                reason,
                failureCount: this.actionFailureCounts.get(key) || 0,
                objects: analysis?.objects?.slice?.(0, 8) || []
            },
            framePath: imagePath,
            nextStep: verified ? 'Use verified perception for the next action.' : 'Stop retrying after repeated failures and queue repair.'
        }).catch(err => this.logger.warn(`[VisionDaemon] Loop ledger write failed: ${err.message}`));

        if (!verified && (this.actionFailureCounts.get(key) || 0) >= 2) {
            await this._queueActionRepairGoal(actionPayload, reason).catch(err => {
                this.logger.warn(`[VisionDaemon] Repair goal queue failed: ${err.message}`);
            });
        }
    }

    async _queueActionRepairGoal(actionPayload = {}, reason = '') {
        const system = global.__SOMA_SYSTEM || {};
        const planner = system.goalPlanner;
        if (!planner?.createGoal) return null;
        const action = actionPayload.action || actionPayload.type || 'action';
        return await planner.createGoal({
            type: 'operational',
            category: 'vision_action_verification',
            title: `Repair repeated visual verification failure: ${action}`,
            description: [
                `VisionDaemon saw repeated hand-eye verification failures for action "${action}".`,
                `Reason: ${reason || 'No visual change detected.'}`,
                `Payload: ${JSON.stringify(actionPayload).slice(0, 500)}`,
                'Inspect ComputerControl coordinates, screen capture timing, and action target selection.',
                'Success means the same action either verifies visually or is blocked before execution.'
            ].join('\n'),
            priority: 82,
            requireQuality: false,
            confidence: 0.84,
            metadata: {
                source: 'vision_action_verification_loop',
                actionPayload
            },
            verification: {
                required: true,
                evidence: ['LoopLedger vision_action_verification events', 'focused hand-eye verification test']
            }
        }, 'vision-daemon');
    }

    async _hashImage(filePath) {
        try {
            const data = await fs.readFile(filePath);
            return crypto.createHash('md5').update(data).digest('hex');
        } catch (e) {
            return null;
        }
    }

    health() {
        return {
            ...super.health(),
            channel: this.channel,
            metrics: this.metrics,
            hasBrain: !!this.visionProcessing,
            hasHands: !!this.computerControl
        };
    }
}

export default VisionDaemon;
