import { canonicalExecutionValue, executionValueHash } from './ExecutionEventLedger.js';

function comparable(value) {
    return canonicalExecutionValue(value);
}

/**
 * Replays recorded tool results without contacting any LLM provider. Optional
 * verification re-executes only tools explicitly marked replaySafe.
 */
export class MissionReplayRunner {
    constructor({ ledger, toolRegistry = null } = {}) {
        if (!ledger) throw new TypeError('MissionReplayRunner requires an execution ledger');
        this.ledger = ledger;
        this.toolRegistry = toolRegistry;
    }

    async load(sessionId) {
        const events = await this.ledger.readSession(sessionId);
        if (!events.length) throw new Error(`No recorded execution session: ${sessionId}`);
        return events;
    }

    async createRecordedToolAdapter(sessionId, { strict = true } = {}) {
        const events = await this.load(sessionId);
        const calls = events.filter(event => event.type === 'tool/call');
        const results = new Map(events.filter(event => event.type === 'tool/result').map(event => [event.data.callId, event.data]));
        let cursor = 0;
        return {
            remaining: () => calls.length - cursor,
            execute: async (name, args = {}) => {
                const call = calls[cursor++];
                if (!call) throw new Error(`Replay exhausted before tool ${name}`);
                if (strict && call.data.name !== name) throw new Error(`Replay divergence: expected ${call.data.name}, received ${name}`);
                if (strict && call.data.argumentHash && call.data.argumentHash !== executionValueHash(args)) {
                    throw new Error(`Replay divergence: arguments changed for ${name}`);
                }
                const result = results.get(call.data.callId);
                if (!result) throw new Error(`Recorded result missing for call ${call.data.callId}`);
                if (!result.ok) {
                    const error = new Error(result.error?.message || `Recorded tool ${name} failed`);
                    error.code = result.error?.code || 'REPLAYED_TOOL_ERROR';
                    throw error;
                }
                return result.value;
            }
        };
    }

    async verifyReplaySafeTools(sessionId, { toolRegistry = this.toolRegistry, context = {} } = {}) {
        if (!toolRegistry) throw new TypeError('Replay verification requires a tool registry');
        const events = await this.load(sessionId);
        const results = new Map(events.filter(event => event.type === 'tool/result').map(event => [event.data.callId, event.data]));
        const receipts = [];
        for (const event of events.filter(item => item.type === 'tool/call')) {
            const tool = toolRegistry.getTool(event.data.name);
            if (!tool?.replaySafe) {
                receipts.push({ callId: event.data.callId, tool: event.data.name, status: 'skipped_not_replay_safe' });
                continue;
            }
            const expected = results.get(event.data.callId);
            try {
                const actual = await toolRegistry.execute(event.data.name, event.data.arguments || {}, {
                    ...context,
                    replayVerification: true,
                    record: false
                });
                receipts.push({
                    callId: event.data.callId,
                    tool: event.data.name,
                    status: comparable(actual) === comparable(expected?.value) ? 'matched' : 'mismatched',
                    expectedHash: executionValueHash(expected?.value),
                    actualHash: executionValueHash(actual)
                });
            } catch (error) {
                receipts.push({ callId: event.data.callId, tool: event.data.name, status: 'execution_failed', error: error.message });
            }
        }
        return {
            sessionId,
            deterministic: receipts.every(receipt => ['matched', 'skipped_not_replay_safe'].includes(receipt.status)),
            receipts
        };
    }
}

export default MissionReplayRunner;
