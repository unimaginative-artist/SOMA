import { SelfModificationPipeline } from './SelfModificationPipeline.js';
import { SelfModificationGovernance } from './SelfModificationGovernance.js';
import { VersionedArtifactRegistry } from './VersionedArtifactRegistry.js';
import { SelfRepairDeployment } from './SelfRepairDeployment.js';
import { SelfRepairCoordinator } from './SelfRepairCoordinator.js';

export function wireSelfModificationRuntime(system, logger = console) {
    if (system.selfModPipeline) return system.selfModPipeline;
    if (!system.engineeringSwarm) {
        throw new Error('SelfModificationPipeline requires EngineeringSwarmArbiter');
    }

    const pipeline = new SelfModificationPipeline();
    pipeline.initialize(system);
    system.selfModPipeline = pipeline;
    const governance = new SelfModificationGovernance({ system });
    system.selfModificationGovernance = governance;
    pipeline.governanceReady = governance.initialize(system).then(async () => {
        const artifacts = new VersionedArtifactRegistry({ governance });
        await artifacts.initialize();
        system.versionedArtifactRegistry = artifacts;
        system.selfRepairDeployment = new SelfRepairDeployment({ system, governance }).start();
        system.selfRepairCoordinator = await new SelfRepairCoordinator({ system }).initialize();
        return governance;
    }).catch(error => {
        logger.error(`[SOMA V2] Self-modification governance unavailable: ${error.message}`);
        return null;
    });
    // Several loaders historically handed arbiters partial system objects.
    // Self-modification must use the canonical runtime object or direct swarm
    // calls can miss the pipeline and authority configuration entirely.
    system.engineeringSwarm.system = system;
    logger.log('[SOMA V2] SelfModificationPipeline wired: review, isolation, Git rollback, probation, and governance enforced');
    return pipeline;
}
