import { LimbicArbiter } from '../../arbiters/LimbicArbiter.js';
import { InternalInstinctCore } from '../../arbiters/InternalInstinctCore.js';

export async function loadLimbicSystem(system) {
    console.log('\n[Loader] 🧠 Initializing Limbic System & Soul...');

    const limbicArbiter = new LimbicArbiter({
        messageBroker: system.messageBroker
    });
    
    const iic = new InternalInstinctCore({
        limbicArbiter: limbicArbiter,
        quadBrain: system.quadBrain,
        messageBroker: system.messageBroker
    });

    await limbicArbiter.initialize();
    await iic.initialize();

    return {
        limbicArbiter,
        internalInstinctCore: iic
    };
}
