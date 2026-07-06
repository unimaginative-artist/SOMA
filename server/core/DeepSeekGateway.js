import fs from 'fs';
import path from 'path';
import costLedger from './CostLedger.js';

const ENDPOINT = 'https://api.deepseek.com/v1/chat/completions';
const STATE_PATH = path.join(process.cwd(), 'data', 'deepseek-gateway-state.json');

function numberEnv(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) ? value : fallback;
}

function textContent(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map(item => item?.text || item?.content || '').join('\n');
    return content == null ? '' : JSON.stringify(content);
}

export function estimateTokens(value) {
    return Math.ceil(String(value || '').length / 4);
}

export function estimateMessageTokens(messages = [], tools = null) {
    const messageTokens = messages.reduce((sum, message) =>
        sum
        + estimateTokens(textContent(message?.content))
        + estimateTokens(message?.tool_calls ? JSON.stringify(message.tool_calls) : '')
        + 8, 0);
    return messageTokens + estimateTokens(tools ? JSON.stringify(tools) : '');
}

function trimContent(content, maxChars) {
    const value = textContent(content);
    if (value.length <= maxChars) return value;
    const head = Math.max(500, Math.floor(maxChars * 0.2));
    const tail = Math.max(1000, maxChars - head - 60);
    return `${value.slice(0, head)}\n[...context compacted by DeepSeekGateway...]\n${value.slice(-tail)}`;
}

export function compactMessages(messages = [], { priority = 'background', maxInputTokens = null } = {}) {
    const tokenLimit = maxInputTokens || (priority === 'human'
        ? numberEnv('SOMA_DEEPSEEK_HUMAN_MAX_INPUT_TOKENS', 48_000)
        : numberEnv('SOMA_DEEPSEEK_BACKGROUND_MAX_INPUT_TOKENS', 16_000));
    const charBudget = Math.max(4000, tokenLimit * 4);
    const normalized = messages.map(message => ({
        ...message,
        content: trimContent(message?.content, message?.role === 'tool' ? 6000 : priority === 'human' ? 24000 : 12000),
    }));
    if (estimateMessageTokens(normalized) <= tokenLimit) return normalized;

    const system = normalized.find(message => message.role === 'system');
    const selected = [];
    let used = system ? Math.min(textContent(system.content).length, Math.floor(charBudget * 0.35)) : 0;
    for (let index = normalized.length - 1; index >= 0; index--) {
        const message = normalized[index];
        if (message === system) continue;
        const content = textContent(message.content);
        const remaining = charBudget - used;
        if (remaining <= 500) break;
        const compacted = { ...message, content: trimContent(content, Math.min(content.length, remaining)) };
        selected.unshift(compacted);
        used += textContent(compacted.content).length + 32;
    }
    if (system) {
        selected.unshift({ ...system, content: trimContent(system.content, Math.floor(charBudget * 0.35)) });
    }
    const selectedToolCalls = new Set(selected.flatMap(message =>
        Array.isArray(message.tool_calls) ? message.tool_calls.map(call => call.id).filter(Boolean) : []
    ));
    return selected.filter(message => message.role !== 'tool' || selectedToolCalls.has(message.tool_call_id));
}

function combineSignal(signal, timeoutMs) {
    const timeout = AbortSignal.timeout(timeoutMs);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

class DeepSeekGateway {
    constructor() {
        this.endpoint = process.env.DEEPSEEK_ENDPOINT || ENDPOINT;
    }

    _loadState() {
        try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); }
        catch { return { backgroundCircuitUntil: 0, incidents: [] }; }
    }

    _saveState(state) {
        fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
        const temporary = `${STATE_PATH}.${process.pid}.tmp`;
        fs.writeFileSync(temporary, JSON.stringify(state, null, 2));
        fs.renameSync(temporary, STATE_PATH);
    }

    _checkAnomaly(priority) {
        if (priority === 'human') return { ok: true };
        const state = this._loadState();
        if (state.backgroundCircuitUntil > Date.now()) {
            return { ok: false, reason: 'background_anomaly_circuit_open', until: state.backgroundCircuitUntil };
        }

        const windowMs = numberEnv('SOMA_DEEPSEEK_ANOMALY_WINDOW_MS', 5 * 60_000);
        const recent = costLedger.getWindowReport(windowMs, 0, 'background');
        const previous = costLedger.getWindowReport(windowMs, windowMs, 'background');
        const hardLimit = numberEnv('SOMA_DEEPSEEK_BACKGROUND_CALLS_PER_WINDOW', 30);
        const minimumForRatio = numberEnv('SOMA_DEEPSEEK_ANOMALY_MIN_CALLS', 12);
        const ratio = numberEnv('SOMA_DEEPSEEK_ANOMALY_RATIO', 2);
        const anomalous = recent.calls >= hardLimit
            || (recent.calls >= minimumForRatio && previous.calls > 0 && recent.calls >= previous.calls * ratio);
        if (!anomalous) return { ok: true, recent, previous };

        const cooldownMs = numberEnv('SOMA_DEEPSEEK_ANOMALY_COOLDOWN_MS', 15 * 60_000);
        state.backgroundCircuitUntil = Date.now() + cooldownMs;
        state.incidents = [...(state.incidents || []), {
            detectedAt: Date.now(),
            reason: 'background_call_rate_anomaly',
            recent,
            previous,
            circuitUntil: state.backgroundCircuitUntil,
        }].slice(-100);
        this._saveState(state);
        return { ok: false, reason: 'background_call_rate_anomaly', until: state.backgroundCircuitUntil, recent, previous };
    }

    _prepare({ model = 'deepseek-chat', messages = [], tools = null, maxTokens = 1024, priority = 'background', actor = 'SOMA', action = 'unknown', dailyCallLimit = null } = {}) {
        const anomaly = this._checkAnomaly(priority);
        if (!anomaly.ok) {
            const error = new Error(`DeepSeek background request blocked: ${anomaly.reason}`);
            error.code = 'DEEPSEEK_ANOMALY_BLOCKED';
            error.details = anomaly;
            throw error;
        }

        const compactedMessages = compactMessages(messages, { priority });
        const inputTokens = estimateMessageTokens(compactedMessages, tools);
        const reservationResult = costLedger.reserve({
            model,
            inputTokens,
            maxOutputTokens: maxTokens,
            actor,
            action,
            priority,
            dailyCallLimit,
        });
        if (!reservationResult.ok) {
            const error = new Error(`DeepSeek request blocked: ${reservationResult.reason}`);
            error.code = 'DEEPSEEK_BUDGET_BLOCKED';
            error.details = reservationResult;
            throw error;
        }
        return { compactedMessages, inputTokens, reservation: reservationResult.reservation };
    }

    async complete({ apiKey = process.env.DEEPSEEK_API_KEY, model = 'deepseek-chat', messages = [], tools = null, toolChoice = null, maxTokens = 1024, temperature = 0.7, priority = 'background', actor = 'SOMA', action = 'unknown', dailyCallLimit = null, timeoutMs = 45_000, signal = null, responseFormat = null } = {}) {
        if (!apiKey) throw new Error('DEEPSEEK_API_KEY not configured');
        const prepared = this._prepare({ model, messages, tools, maxTokens, priority, actor, action, dailyCallLimit });
        const body = {
            model,
            messages: prepared.compactedMessages,
            temperature,
            max_tokens: maxTokens,
        };
        if (tools?.length) body.tools = tools;
        if (toolChoice) body.tool_choice = toolChoice;
        if (responseFormat) body.response_format = responseFormat;

        try {
            const response = await fetch(this.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
                body: JSON.stringify(body),
                signal: combineSignal(signal, timeoutMs),
            });
            if (!response.ok) {
                const payload = await response.json().catch(async () => ({ message: await response.text().catch(() => '') }));
                throw new Error(payload?.error?.message || payload?.message || `DeepSeek HTTP ${response.status}`);
            }
            const data = await response.json();
            const usage = data.usage || {};
            costLedger.commitReservation(prepared.reservation.id, {
                inputTokens: usage.prompt_tokens || prepared.inputTokens,
                outputTokens: usage.completion_tokens || estimateTokens(data.choices?.[0]?.message?.content || ''),
                metadata: { requestModel: model, compacted: prepared.compactedMessages.length !== messages.length },
            });
            return { data, usage, messages: prepared.compactedMessages };
        } catch (error) {
            costLedger.releaseReservation(prepared.reservation.id);
            throw error;
        }
    }

    async openStream({ apiKey = process.env.DEEPSEEK_API_KEY, model = 'deepseek-chat', messages = [], maxTokens = 512, temperature = 0.7, priority = 'human', actor = 'SOMA', action = 'stream_chat', dailyCallLimit = null, timeoutMs = 45_000, signal = null } = {}) {
        if (!apiKey) throw new Error('DEEPSEEK_API_KEY not configured');
        const prepared = this._prepare({ model, messages, maxTokens, priority, actor, action, dailyCallLimit });
        try {
            const response = await fetch(this.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
                body: JSON.stringify({
                    model,
                    messages: prepared.compactedMessages,
                    temperature,
                    max_tokens: maxTokens,
                    stream: true,
                    stream_options: { include_usage: true },
                }),
                signal: combineSignal(signal, timeoutMs),
            });
            if (!response.ok) {
                const message = await response.text().catch(() => '');
                throw new Error(`DeepSeek HTTP ${response.status}: ${message.slice(0, 300)}`);
            }
            let settled = false;
            return {
                response,
                messages: prepared.compactedMessages,
                finalize: ({ usage = {}, outputText = '' } = {}) => {
                    if (settled) return;
                    settled = true;
                    costLedger.commitReservation(prepared.reservation.id, {
                        inputTokens: usage.prompt_tokens || prepared.inputTokens,
                        outputTokens: usage.completion_tokens || estimateTokens(outputText),
                        metadata: { requestModel: model, streamed: true },
                    });
                },
                release: () => {
                    if (settled) return;
                    settled = true;
                    costLedger.releaseReservation(prepared.reservation.id);
                },
            };
        } catch (error) {
            costLedger.releaseReservation(prepared.reservation.id);
            throw error;
        }
    }

    getStatus() {
        const state = this._loadState();
        return {
            endpoint: this.endpoint,
            backgroundCircuitOpen: state.backgroundCircuitUntil > Date.now(),
            backgroundCircuitUntil: state.backgroundCircuitUntil || 0,
            recentBackground: costLedger.getWindowReport(5 * 60_000, 0, 'background'),
            previousBackground: costLedger.getWindowReport(5 * 60_000, 5 * 60_000, 'background'),
            incidents: (state.incidents || []).slice(-10).reverse(),
        };
    }
}

export const deepSeekGateway = new DeepSeekGateway();
export default deepSeekGateway;
