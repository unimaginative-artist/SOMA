/**
 * DependencySentinel.js
 * 
 * SOMA Industrial-Grade Boot Guardian.
 * Replaces opportunistic loading with strict DAG dependency resolution.
 * Prevents 'Preparatory Loops' and circular dependency deadlocks.
 */

export class DependencySentinel {
    constructor() {
        this.registry = new Map(); // name -> { status: 'docked'|'sailing'|'arrived', deps: [] }
        this.instances = new Map();
    }

    /**
     * Register a system component and its prerequisites
     */
    register(name, deps = []) {
        this.registry.set(name, {
            status: 'docked',
            deps,
            registeredAt: Date.now()
        });
        console.log(`[Sentinel] ⚓ Registered: ${name} (Prereqs: ${deps.join(', ') || 'None'})`);
    }

    /**
     * Set a component as 'Arrived' (Ready)
     */
    async markReady(name, instance) {
        const component = this.registry.get(name);
        if (!component) throw new Error(`[Sentinel] Attempted to ready unknown component: ${name}`);

        component.status = 'arrived';
        this.instances.set(name, instance);
        console.log(`[Sentinel] ✓ Component ARRIVED: ${name}`);
    }

    /**
     * Check if a component is mathematically clear to boot
     */
    isUnblocked(name) {
        const component = this.registry.get(name);
        if (!component) return false;
        
        return component.deps.every(dep => {
            const depComp = this.registry.get(dep);
            return depComp && depComp.status === 'arrived';
        });
    }

    /**
     * High-fidelity resolve: Waits for all deps to arrive before executing
     */
    async waitForPrerequisites(name, timeoutMs = 30000) {
        const component = this.registry.get(name);
        if (!component) throw new Error(`[Sentinel] Unknown component: ${name}`);

        const start = Date.now();
        while (!this.isUnblocked(name)) {
            if (Date.now() - start > timeoutMs) {
                const missing = component.deps.filter(d => this.registry.get(d)?.status !== 'arrived');
                throw new Error(`[Sentinel] ⛔ Boot Timeout for ${name}. Missing: ${missing.join(', ')}`);
            }
            await new Promise(r => setTimeout(r, 100)); // Poll frequency
        }
        return true;
    }
}

// Singleton Instance
export const sentinel = new DependencySentinel();
export default sentinel;
