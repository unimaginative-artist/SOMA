function normalizedNames(values = []) {
    return [...new Set((Array.isArray(values) ? values : []).map(value => String(value || '').trim()).filter(Boolean))];
}

/**
 * Describes the capabilities available to an execution session. Profiles are
 * operational envelopes only: they do not select models, personas, or ideas.
 */
export class ExecutionProfileRegistry {
    constructor() {
        this.profiles = new Map();
        this.register('default', { description: 'Current SOMA behavior with no additional tool restrictions.' });
        this.register('business-planning-collaboration', {
            description: 'Observable collaborative business planning session.',
            tags: ['business-planning', 'personas', 'research', 'finance']
        });
        this.register('self-modification-governed', {
            description: 'Observable self-modification session; existing SOMA governance remains authoritative.',
            tags: ['self-modification', 'governed', 'verification']
        });
    }

    register(id, definition = {}) {
        const key = String(id || '').trim();
        if (!key) throw new TypeError('Execution profile id is required');
        const profile = Object.freeze({
            id: key,
            description: String(definition.description || ''),
            allowTools: definition.allowTools == null ? null : normalizedNames(definition.allowTools),
            denyTools: normalizedNames(definition.denyTools),
            personas: normalizedNames(definition.personas),
            plugins: normalizedNames(definition.plugins),
            tags: normalizedNames(definition.tags),
            metadata: Object.freeze({ ...(definition.metadata || {}) })
        });
        this.profiles.set(key, profile);
        return () => this.profiles.delete(key);
    }

    get(id = 'default') {
        return this.profiles.get(String(id || 'default')) || null;
    }

    allowsTool(id, toolName) {
        const profile = this.get(id);
        if (!profile) return { allowed: false, reason: `Unknown execution profile: ${id}` };
        if (profile.denyTools.includes(toolName)) return { allowed: false, reason: `Tool ${toolName} is denied by profile ${profile.id}` };
        if (profile.allowTools && !profile.allowTools.includes(toolName)) return { allowed: false, reason: `Tool ${toolName} is not allowed by profile ${profile.id}` };
        return { allowed: true, profile };
    }

    list() {
        return [...this.profiles.values()];
    }
}

export default ExecutionProfileRegistry;
