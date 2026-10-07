/** Publishes bounded summaries; specialized systems retain ownership of raw data. */
export class CanonicalStateProjector {
    constructor({ system, intervalMs = 30_000 } = {}) {
        this.system = system;
        this.intervalMs = intervalMs;
        this.timer = null;
    }

    async refresh() {
        const gateway = this.system?.stateGateway;
        if (!gateway) return;
        const writes = [];

        const goals = await this.system.goalPlanner?.getActiveGoals?.();
        if (goals) {
            const list = Array.isArray(goals) ? goals : goals.goals || [];
            writes.push(gateway.publish('goals', 'active_summary', list.slice(0, 20).map(goal => ({
                id: goal.id, title: goal.title, status: goal.status, progress: goal.progress ?? null
            })), { owner: 'GoalPlanner', source: 'goal-planner', status: 'observed', confidence: 1 }));
        }

        const perception = this.system.visionDaemon?.lastPerception;
        if (perception) {
            const scene = perception.scene || perception;
            writes.push(gateway.publish('vision', 'latest_scene', {
                timestamp: perception.timestamp || scene.timestamp || null,
                objectCount: Array.isArray(scene.objects) ? scene.objects.length : (scene.objectCount ?? null),
                labels: Array.isArray(scene.objects) ? scene.objects.slice(0, 30).map(item => item.label || item.class).filter(Boolean) : [],
                tracks: Array.isArray(scene.objects) ? scene.objects.slice(0, 30).map(item => ({ trackId: item.trackId || null, label: item.label || item.class, category: item.category || null, identityLabel: item.identityLabel || null })).filter(item => item.trackId) : [],
                framePath: perception.imagePath || this.system.visionDaemon.lastIngestedFramePath || null
            }, { owner: 'VisionDaemon', source: 'vision-daemon', status: 'observed', confidence: Number(perception.confidence ?? 0.7) }));
        }

        if (this.system.embodimentRuntime?.getStatus) {
            const body = this.system.embodimentRuntime.getStatus();
            writes.push(gateway.publish('embodiment', 'body_status', {
                simulation: body.simulation, armed: body.armed, emergencyStop: body.emergencyStop,
                sensorCount: body.sensors?.length ?? body.sensorCount ?? null,
                actuatorCount: body.actuators?.length ?? body.actuatorCount ?? null
            }, { owner: 'EmbodimentRuntime', source: 'embodiment-runtime', status: 'observed', confidence: 1 }));
        }

        const guard = this.system.tradingPerformanceGuard;
        if (guard?.getStatus) {
            const status = guard.getStatus();
            writes.push(gateway.publish('trading', 'safety_summary', {
                mode: status.mode || status.status || null,
                restrictedStrategies: status.restrictedStrategies?.length ?? status.restrictedCount ?? null,
                matureEvidence: status.matureEvidence ?? null,
                updatedAt: status.updatedAt || null
            }, { owner: 'TradingPerformanceGuard', source: 'trading-performance-guard', status: 'observed', confidence: 1 }));
        }

        if (this.system.audioDaemon?.getStatus) {
            const audio = this.system.audioDaemon.getStatus();
            writes.push(gateway.publish('audio', 'hearing_status', {
                enabled: audio.enabled, state: audio.state, mode: audio.mode,
                wakePhrase: audio.wakePhrase, device: audio.device,
                lastCommandAt: audio.lastCommand?.timestamp || null,
                error: audio.lastError || null
            }, { owner: 'AudioDaemon', source: 'local-audio', status: 'observed', confidence: 1 }));
        }

        await Promise.allSettled(writes);
    }

    start() {
        if (this.timer) return;
        this.refresh().catch(() => {});
        this.timer = setInterval(() => this.refresh().catch(() => {}), this.intervalMs);
        this.timer.unref?.();
    }

    stop() {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
    }
}

export default CanonicalStateProjector;
