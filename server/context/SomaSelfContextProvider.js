import { buildSomaContext, isSomaSelfQuery } from './SomaContextKernel.js';
import fs from 'fs/promises';
import path from 'path';

const SELF_MODEL_PATH = path.join(process.cwd(), 'SOMA', 'working-self-model.json');

export async function buildSomaSelfContext(query = '', options = {}) {
    const context = await buildSomaContext(query, options);
    const renamed = context
        .replace('[SOMA CONTEXT KERNEL]', '[SOMA SELF-CONTEXT]')
        .replace('[/SOMA CONTEXT KERNEL]', '[/SOMA SELF-CONTEXT]');
    if (options.publicOnly) return renamed;
    const selfModel = await readWorkingSelfModel();
    if (!selfModel) return renamed;
    return `${renamed}\n\n${selfModel}`;
}

async function readWorkingSelfModel() {
    try {
        const model = JSON.parse(await fs.readFile(SELF_MODEL_PATH, 'utf8'));
        const signals = Array.isArray(model.signals) ? model.signals.slice(0, 5) : [];
        const actions = Array.isArray(model.nextActions) ? model.nextActions.slice(0, 4) : [];
        const principles = Array.isArray(model.principles) ? model.principles.slice(0, 4) : [];
        if (!signals.length && !actions.length && !principles.length) return '';
        return [
            '[MEMORY SPINE SELF-MODEL]',
            principles.length ? `Principles:\n${principles.map(item => `- ${item}`).join('\n')}` : null,
            signals.length ? `High-signal memory clusters:\n${signals.map(item => `- ${item.signal}: ${item.count} evidence item(s)`).join('\n')}` : null,
            actions.length ? `Bounded next actions:\n${actions.map(item => `- ${item.title}: ${item.reason}`).join('\n')}` : null,
            'Use this as retrieved evidence. Do not turn these into repetitive autonomous chat updates.',
            '[/MEMORY SPINE SELF-MODEL]'
        ].filter(Boolean).join('\n');
    } catch {
        return '';
    }
}

export { isSomaSelfQuery as isSelfAccessQuery };

export default {
    buildSomaSelfContext,
    isSelfAccessQuery: isSomaSelfQuery
};
